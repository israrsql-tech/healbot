import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

export default function ChatWidget({ selectedPatient }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
  role: "assistant",
  content:
    "Hi! Ask me about any medicine (uses, side effects, interactions), or say 'remind me' to check your schedule.",
},

  ]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);
  
    useEffect(() => {
    // Patient change hote hi chat reset
    setMessages([
      {
        role: "assistant",
        content:
          "Hi! Ask me about any medicine (uses, side effects, interactions), or say 'remind me' to check your schedule.",
      },
    ]);
    setInput("");
    setLoading(false);
  }, [selectedPatient]);


  

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      if (!selectedPatient) {
        setMessages([
          ...next,
          { role: "assistant", content: "Please select a family member first." },
        ]);
        setLoading(false);
        return;
      }
      const tkn = localStorage.getItem("token");
     const res = await axios.post(
        "https://healbot-backend-production.up.railway.app/api/chat",
        { messages: next, patient_id: selectedPatient },
        { headers: { Authorization: `Bearer ${tkn}` } }
      );




      setMessages([...next, { role: "assistant", content: res.data.reply }]);
    } catch (e) {
            console.log("CHAT ERROR", e?.response?.status, e?.response?.data, e?.message);
      setMessages([
        ...next,
        { role: "assistant", content: `Error: ${e?.response?.status} ${e?.response?.data?.error || e?.message}` },
      ]);


      // setMessages([
      //   ...next,
      //   { role: "assistant", content: "Error: chat service not available." },
      // ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button className="chat-fab" onClick={() => setOpen((v) => !v)}>
        Chat
      </button>

      {open && (
        <div className="chat-window">
          <div className="chat-header">
            <div>HealBot Assistant</div>
            <button className="chat-close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>

          <div className="chat-body">
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            <div ref={endRef} />
          </div>
            
<div className="chat-input">
  <input
    value={input}
    placeholder="Type here..."
    onChange={(e) => setInput(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") send();
    }}
  />

  <button
    type="button"
    className="chat-send-btn"
    onClick={send}
    disabled={loading || input.trim().length === 0}
    aria-label="Send message"
    title="Send"
  >
    <svg viewBox="0 0 24 24" className="chat-send-icon" aria-hidden="true">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  </button>
</div>

        </div>
      )}
    </>
  );
}
