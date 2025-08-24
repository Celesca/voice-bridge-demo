import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors({ origin: true }));
// Capture raw body for LINE signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      // @ts-ignore
      req.rawBody = buf;
    },
  })
);

// Simple in-memory cache of last IDs seen via webhook
const lastIds = {
  userId: null,
  groupId: null,
  roomId: null,
  lastEventType: null,
  lastTimestamp: null,
};

// --- OpenRouter Summarization ---
async function summarizeWithOpenRouter(text, locale = 'th-TH') {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    const system =
      locale === 'th-TH'
        ? 'คุณเป็นผู้ช่วยที่สรุปสิ่งที่ผู้บกพร่องทางการได้ยินควรทำจากข้อความเสียง ให้คำแนะนำสั้น กระชับ เป็นเชิงคำสั่ง (เช่น ทำ/ติดต่อ/ตรวจสอบ) ไม่เกิน 3 ข้อ ใช้ภาษาไทยง่ายๆ'
        : 'You are an assistant that extracts short action items for a Deaf user from the transcript. Use imperative, 1-3 concise bullet points.';

    const prompt =
      locale === 'th-TH'
        ? `สรุปเป็นรายการสิ่งที่ต้องทำจากข้อความต่อไปนี้ โดยย่อ ไม่เกิน 3 ข้อ:\n\n${text}`
        : `Summarize into 1-3 concise action items a Deaf person should do from this transcript:\n\n${text}`;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Optional, helpful for OpenRouter stats
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Voice-Bridge',
      },
      body: JSON.stringify({
        model: 'google/gemma-3n-e2b-it:free',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error('OpenRouter error:', t);
      return null;
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return (content || '').trim();
  } catch (e) {
    console.error('summarizeWithOpenRouter failed', e);
    return null;
  }
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Simple root page for diagnostics
app.get('/', (_req, res) => {
  res.send('Voice-Bridge backend is running. POST /webhook for LINE.');
});

// Optional GET for webhook path to assist with 404 diagnostics
app.get('/webhook', (_req, res) => {
  res.status(200).send('Webhook endpoint is alive. Use POST from LINE platform.');
});

// Push a text message via LINE Messaging API
app.post('/api/notify-line', async (req, res) => {
  try {
    const { message, to } = req.body || {};
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    // Fallback order: explicit 'to' -> env LINE_USER_ID -> last seen ids from webhook
    const targetId =
      to ||
      process.env.LINE_USER_ID ||
      lastIds.userId ||
      lastIds.groupId ||
      lastIds.roomId;

    if (!accessToken) {
      return res.status(500).json({ error: 'Missing LINE_CHANNEL_ACCESS_TOKEN in environment.' });
    }
    if (!targetId) {
      return res.status(400).json({ error: 'Missing target recipient. Provide "to" in body or set LINE_USER_ID in env.' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message.' });
    }

  const resp = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: targetId,
        messages: [{ type: 'text', text: message.substring(0, 5000) }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: 'LINE API error', details: text });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('notify-line error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// LINE Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const signature = req.header('x-line-signature');
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (!channelSecret) {
      console.error('Missing LINE_CHANNEL_SECRET');
      return res.status(500).send('Server misconfigured');
    }

    // @ts-ignore
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const computed = crypto
      .createHmac('sha256', channelSecret)
      .update(rawBody)
      .digest('base64');

    if (!signature || computed !== signature) {
      console.warn('Invalid LINE signature');
      return res.status(401).send('Invalid signature');
    }

    const events = req.body?.events || [];
    // Acknowledge immediately to avoid retries
    res.status(200).send('OK');

    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) {
      console.error('Missing LINE_CHANNEL_ACCESS_TOKEN');
      return;
    }

    for (const ev of events) {
      try {
        // Capture and log IDs for convenience
        const src = ev.source || {};
        if (src.userId) lastIds.userId = src.userId;
        if (src.groupId) lastIds.groupId = src.groupId;
        if (src.roomId) lastIds.roomId = src.roomId;
        lastIds.lastEventType = ev.type;
        lastIds.lastTimestamp = ev.timestamp || Date.now();

        if (src.userId || src.groupId || src.roomId) {
          console.log('--- LINE Source IDs ---');
          if (src.userId) console.log('userId:', src.userId);
          if (src.groupId) console.log('groupId:', src.groupId);
          if (src.roomId) console.log('roomId:', src.roomId);
          console.log('-----------------------');
        }

  if (ev.type === 'message' && ev.message?.type === 'text') {
          const incoming = ev.message.text || '';
          const src = ev.source || {};
          const idLines = [
            'Source IDs:',
            src.userId ? `userId: ${src.userId}` : 'userId: -',
            src.groupId ? `groupId: ${src.groupId}` : 'groupId: -',
            src.roomId ? `roomId: ${src.roomId}` : 'roomId: -',
          ];
          const text = [`Received: ${incoming}`, ...idLines].join('\n');

          const reply = {
            replyToken: ev.replyToken,
            messages: [
              {
                type: 'text',
                text,
              },
            ],
          };
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(reply),
          });
        }

        // Reply IDs when the bot is added as a friend (1:1)
        if (ev.type === 'follow') {
          const src = ev.source || {};
          const text = [
            'Thanks for adding Voice-Bridge! Here are your IDs:',
            src.userId ? `userId: ${src.userId}` : 'userId: -',
          ].join('\n');
          const reply = {
            replyToken: ev.replyToken,
            messages: [{ type: 'text', text }],
          };
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(reply),
          });
        }

        // Reply IDs when the bot joins a group/room
        if (ev.type === 'join') {
          const src = ev.source || {};
          const text = [
            'Voice-Bridge joined. Here are this chat IDs:',
            src.groupId ? `groupId: ${src.groupId}` : 'groupId: -',
            src.roomId ? `roomId: ${src.roomId}` : 'roomId: -',
          ].join('\n');
          const reply = {
            replyToken: ev.replyToken,
            messages: [{ type: 'text', text }],
          };
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(reply),
          });
        }
        // Add other event types handling if needed (follow, join, postback, etc.)
      } catch (innerErr) {
        console.error('Error handling event', innerErr);
      }
    }
  } catch (err) {
    console.error('webhook error', err);
    // best effort ack
    if (!res.headersSent) res.status(200).send('OK');
  }
});

// Endpoint called by the frontend when a detection occurs
app.post('/api/report-detection', async (req, res) => {
  try {
    let { matchedText, recognizedText, summary, to, serverSummary, locale } = req.body || {};
    // If caller requests server-side summary or none provided, try OpenRouter
    if ((!summary && recognizedText) || serverSummary) {
      const ai = await summarizeWithOpenRouter(recognizedText, locale || 'th-TH');
      if (ai) summary = ai;
      else if (process.env.LOCAL_SUMMARY_FALLBACK === '1') {
        // simple local fallback: first sentence up to 200 chars
        const first = (recognizedText || '').split(/[.!?\n]/)[0] || recognizedText;
        summary = (first || '').slice(0, 200);
      }
      console.log('[report-detection] summary prepared:', summary ? `${summary.length} chars` : 'none');
    }
    const messageLines = [
      'Voice-Bridge detection triggered ✅',
      matchedText ? `Matched: ${matchedText}` : null,
      recognizedText ? `Heard: ${recognizedText}` : null,
      summary ? `Summary (AI): ${summary}` : null,
      `Time: ${new Date().toLocaleString()}`,
    ].filter(Boolean);

    const message = messageLines.join('\n');

    // Reuse push endpoint
    const resp = await fetch('http://localhost:' + PORT + '/api/notify-line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, to }),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: 'Failed to notify LINE', details: data });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('report-detection error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Expose last seen IDs
app.get('/api/last-ids', (_req, res) => {
  res.json(lastIds);
});

// Basic env check (does not reveal secrets)
app.get('/api/env-check', (_req, res) => {
  res.json({
    hasAccessToken: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    hasChannelSecret: Boolean(process.env.LINE_CHANNEL_SECRET),
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    lineUserId: process.env.LINE_USER_ID || null,
  localSummaryFallback: process.env.LOCAL_SUMMARY_FALLBACK === '1',
    lastIds,
  });
});

// Expose standalone summarize endpoint
app.post('/api/summarize', async (req, res) => {
  try {
    const { text, locale } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });
    const out = await summarizeWithOpenRouter(text, locale || 'th-TH');
    if (!out) return res.status(500).json({ error: 'Summarization failed' });
    res.json({ summary: out });
  } catch (e) {
    console.error('summarize endpoint error', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`Voice-Bridge backend listening on http://localhost:${PORT}`);
  console.log('Webhook path: POST /webhook');
});
