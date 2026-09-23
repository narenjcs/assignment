import React, { useState, useRef, useEffect } from 'react';
import './App.css';

const API_BASE = process.env.REACT_APP_API_URL || 'https://YOUR_API_GW_URL/prod';

// ── Upload Component ──────────────────────────────────────
function DocumentUploader({ onJobCreated }) {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState('');
    const fileRef = useRef();

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        setStatus('Getting upload URL...');

        try {
            // Step 1: Get pre-signed URL
            const urlResp = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name })
            });
            const { uploadUrl, s3Key, docType } = await urlResp.json();

            setStatus(`Uploading ${docType} document...`);

            // Step 2: Upload directly to S3
            await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': 'application/octet-stream' }
            });

            setStatus(`✅ Uploaded! Processing ${docType} with ${docType === 'PDF' ? 'Databricks AI Agent' : 'AWS Bedrock Agent'}...`);

            // Step 3: Poll for job completion
            pollJobStatus(s3Key, docType);

        } catch (err) {
            setStatus(`❌ Upload failed: ${err.message}`);
            setUploading(false);
        }
    };

    const pollJobStatus = async (s3Key, docType) => {
        // Wait for S3 trigger to create job (2s delay)
        await new Promise(r => setTimeout(r, 2000));

        const maxAttempts = 60;
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 3000));

            try {
                // Find job by polling recent jobs (simplified — in prod use WebSocket)
                const resp = await fetch(`${API_BASE}/status/latest?s3Key=${encodeURIComponent(s3Key)}`);
                const data = await resp.json();

                if (data.status === 'COMPLETED') {
                    setStatus(`✅ ${docType} processed by ${data.processor}!`);
                    setUploading(false);
                    onJobCreated(data);
                    return;
                } else if (data.status === 'FAILED') {
                    setStatus(`❌ Processing failed: ${data.error}`);
                    setUploading(false);
                    return;
                } else {
                    setStatus(`⏳ Processing... (${data.status}) — ${docType === 'PDF' ? 'Databricks OCR + AI Agent running' : 'AWS Bedrock Agent summarizing'}`);
                }
            } catch (err) {
                console.error('Poll error:', err);
            }
        }
        setStatus('⚠️ Processing taking longer than expected. Check back later.');
        setUploading(false);
    };

    return (
        <div className="uploader">
            <h2>📄 Upload Document</h2>
            <p className="hint">
                <strong>DOCX</strong> → AWS Bedrock Agent (Claude Sonnet 4) &nbsp;|&nbsp;
                <strong>PDF</strong> → Databricks AI Agent (OCR + LangGraph)
            </p>
            <div className="drop-zone" onClick={() => fileRef.current.click()}>
                {file ? `📎 ${file.name}` : 'Click to select PDF or DOCX (max 2 pages)'}
                <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx"
                    style={{ display: 'none' }}
                    onChange={e => setFile(e.target.files[0])}
                />
            </div>
            <button
                className="btn-primary"
                onClick={handleUpload}
                disabled={!file || uploading}
            >
                {uploading ? 'Processing...' : 'Upload & Process'}
            </button>
            {status && <div className="status-msg">{status}</div>}
        </div>
    );
}

// ── Chat Component ────────────────────────────────────────
function ChatInterface({ currentJob }) {
    const [messages, setMessages] = useState([
        {
            role: 'assistant',
            content: '👋 Hello! Upload a document above and I\'ll summarize it for you. You can also ask me questions about processed documents.'
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef();

    useEffect(() => {
        if (currentJob?.summary) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `✅ **Document processed by ${currentJob.processor}**\n\n${currentJob.summary}`
            }]);
        }
    }, [currentJob]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async () => {
        if (!input.trim() || loading) return;
        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);

        try {
            const resp = await fetch(`${API_BASE}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg,
                    jobId: currentJob?.jobId || '',
                    history: messages.slice(-10)
                })
            });
            const data = await resp.json();
            setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `❌ Error: ${err.message}`
            }]);
        }
        setLoading(false);
    };

    return (
        <div className="chat-container">
            <div className="chat-header">
                <h2>💬 AI Document Assistant</h2>
                {currentJob && (
                    <span className="job-badge">
                        Job: {currentJob.jobId?.slice(0, 8)}... | {currentJob.processor}
                    </span>
                )}
            </div>
            <div className="messages">
                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.role}`}>
                        <div className="bubble">
                            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                                {msg.content}
                            </pre>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="message assistant">
                        <div className="bubble typing">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>
            <div className="input-row">
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Ask about your document..."
                    disabled={loading}
                />
                <button className="btn-send" onClick={sendMessage} disabled={loading || !input.trim()}>
                    Send
                </button>
            </div>
        </div>
    );
}

// ── Main App ──────────────────────────────────────────────
export default function App() {
    const [currentJob, setCurrentJob] = useState(null);

    return (
        <div className="app">
            <header className="app-header">
                <h1>🤖 Agentic AI Document Processor</h1>
                <p>AWS Bedrock + Databricks | MCP-Powered | Claude Sonnet 4</p>
            </header>
            <main className="app-main">
                <div className="left-panel">
                    <DocumentUploader onJobCreated={setCurrentJob} />
                    <div className="arch-info">
                        <h3>🏗️ Architecture</h3>
                        <ul>
                            <li>📤 S3 Upload → Lambda Trigger</li>
                            <li>🔀 Orchestrator routes by file type</li>
                            <li>📝 DOCX → AWS Bedrock Agent (MCP)</li>
                            <li>📊 PDF → Databricks AI Agent (MCP)</li>
                            <li>🗄️ Results → DynamoDB + Unity Catalog</li>
                        </ul>
                    </div>
                </div>
                <div className="right-panel">
                    <ChatInterface currentJob={currentJob} />
                </div>
            </main>
        </div>
    );
}
