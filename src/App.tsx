import './App.css';
import { useRef, useState } from 'react';

// Declare global for Window interface
declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

function App() {
  const [recognizedText, setRecognizedText] = useState('');
  const [userInput, setUserInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [useSummary, setUseSummary] = useState(true);
  const [status, setStatus] = useState('');
  const [targetId, setTargetId] = useState('');
  const [lastIds, setLastIds] = useState<any | null>(null);
  const recognitionRef = useRef<any | null>(null);

  const normalizeThai = (text: string) => {
    return (text || '')
      .normalize('NFC')
      .replace(/[\s\u200B\u200C\u200D]/g, '') // spaces & zero-width
      .replace(/[\p{P}\p{S}]/gu, '') // punctuation & symbols
      .toLowerCase();
  };

  const refreshLastIds = async () => {
    try {
      const r = await fetch('/api/last-ids');
      if (r.ok) setLastIds(await r.json());
    } catch {}
  };

  const reportDetection = async (matchedText: string, heard: string) => {
    try {
      setStatus('Notifying LINE...');
      const payload: any = {
        matchedText,
        recognizedText: heard,
        // Request server-side summary (OpenRouter)
        serverSummary: true,
        locale: 'th-TH',
      };
      if (!useSummary) delete payload.serverSummary;
      if (targetId.trim()) payload.to = targetId.trim();

      const resp = await fetch('/api/report-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setStatus('Failed to notify LINE');
        console.error('Notify error', data);
      } else {
        setStatus('Notification sent to LINE ✅');
      }
    } catch (e) {
      console.error(e);
      setStatus('Error sending notification');
    }
  };

  const startRecognition = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Your browser does not support speech recognition.');
      return;
    }

    const recognition = new (window.webkitSpeechRecognition as any)();
    recognitionRef.current = recognition;
    recognition.lang = 'th-TH';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      setStatus('Listening...');
    };

    recognition.onresult = (event: any) => {
      const transcript = (event.results[0][0].transcript as string) || '';
      const heard = transcript.trim();
      setRecognizedText(heard);

      const target = userInput.trim();
      if (target) {
        const matched = normalizeThai(heard).includes(normalizeThai(target));
        if (matched) {
          alert('Matched!');
          reportDetection(target, heard);
        } else {
          setStatus('No match detected');
        }
      } else {
        setStatus('No target set');
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setStatus('Recognition error');
    };

    recognition.onend = () => {
      setIsListening(false);
      if (!status) setStatus('Stopped');
    };

    recognition.start();
  };

  const stopRecognition = () => {
    try {
      recognitionRef.current?.stop?.();
    } catch {}
    setIsListening(false);
    setStatus('Stopped');
  };

  return (
    <div className="app-shell">
      <div className="card">
        <header className="header">
          <h1>Voice-Bridge</h1>
          <p className="subtitle">จับเสียงภาษาไทย แล้วแจ้งเตือนผ่าน LINE</p>
        </header>

        <div className="row">
          <input
            className="input"
            type="text"
            placeholder="ใส่คำที่ต้องการจับ (Enter text to match)"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
          />
        </div>

        <div className="row">
          <input
            className="input"
            type="text"
            placeholder="LINE target (optional userId/groupId/roomId)"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          />
          <button className="btn secondary" onClick={refreshLastIds}>Check LINE IDs</button>
        </div>

        {lastIds && (
          <div className="hint">
            Last IDs → user: {lastIds.userId || '-'} | group: {lastIds.groupId || '-'} | room: {lastIds.roomId || '-'}
          </div>
        )}

        <div className="row between">
          <label className="toggle">
            <input type="checkbox" checked={useSummary} onChange={(e) => setUseSummary(e.target.checked)} />
            <span>สรุปสิ่งที่ควรทำก่อนส่ง LINE</span>
          </label>
          <div className={`status ${isListening ? 'on' : ''}`}>{isListening ? 'Listening' : 'Idle'}</div>
        </div>

        <div className="row actions">
          <button className="btn" onClick={startRecognition} disabled={isListening}>
            ▶ Start Listening
          </button>
          <button className="btn outline" onClick={stopRecognition} disabled={!isListening}>
            ■ Stop
          </button>
        </div>

        <div className="transcript">
          <div className="label">Recognized</div>
          <div className="text">{recognizedText || '—'}</div>
        </div>

        {status && <div className="hint">{status}</div>}
      </div>
    </div>
  );
}

export default App;
