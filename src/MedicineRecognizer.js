// src/MedicineRecognizer.js
import React, { useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";

const OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json";

function cleanText(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function pickCandidateName(ocrText = "") {
  const stop = new Set([
    "tablet", "tablets", "capsule", "capsules", "mg", "ml", "g",
    "strip", "pack", "dose", "dosage", "ip", "usp", "mrp",
    "manufactured", "expiry", "exp", "batch", "lot",
  ]);

  const tokens = String(ocrText)
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const candidates = tokens
    .filter((t) => /^[a-zA-Z][a-zA-Z0-9-]{2,}$/.test(t))
    .filter((t) => !stop.has(t.toLowerCase()))
    .slice(0, 20);

  return candidates.length ? candidates[0] : "";
}

function joinSection(val) {
  if (!val) return "";
  if (Array.isArray(val)) return val.map((v) => String(v)).join("\n\n");
  return String(val);
}

function shortText(text, maxChars = 380) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return { short: "", isLong: false };
  if (t.length <= maxChars) return { short: t, isLong: false };
  return { short: t.slice(0, maxChars).trim() + "…", isLong: true };
}

async function fetchOnce(searchExpr, apiKey) {
  const url =
    `${OPENFDA_LABEL_URL}?search=${encodeURIComponent(searchExpr)}&limit=1` +
    (apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "");

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { res, data, url };
}

function mapLabelResult(r, fallbackName) {
  const brand = r?.openfda?.brand_name?.[0];
  const generic = r?.openfda?.generic_name?.[0];
  const name = brand || generic || fallbackName;

  return {
    name,
    usagesBenefits: joinSection(r.indications_and_usage) || "Not available in label.",
    sideEffects: joinSection(r.adverse_reactions) || "Not available in label.",
    harmfulFor:
      [
        joinSection(r.contraindications),
        joinSection(r.warnings),
        joinSection(r.warnings_and_precautions),
        joinSection(r.boxed_warning),
      ]
        .filter(Boolean)
        .join("\n\n") || "Not available in label.",
    manufacturer: r?.openfda?.manufacturer_name?.[0] || "",
    route: r?.openfda?.route?.[0] || "",
  };
}


async function fetchDrugLabel(term, apiKey) {
  const t = cleanText(term);
  if (!t) throw new Error("Please enter a medicine name.");

  // openFDA supports field-based search like openfda.generic_name:acetaminophen [web:12]
  const queries = [
    `openfda.brand_name:"${t}" OR openfda.generic_name:"${t}" OR openfda.substance_name:"${t}"`,
    `openfda.brand_name:${t}* OR openfda.generic_name:${t}* OR openfda.substance_name:${t}*`,
    t, // last fallback: plain search
  ];

  let lastMsg = "No matches found!";
  for (const q of queries) {
    const { res, data } = await fetchOnce(q, apiKey);

    if (res.ok && data?.results?.length) {
      return mapLabelResult(data.results[0], t);
    }

    lastMsg = data?.error?.message || lastMsg;
  }

  throw new Error(`${lastMsg} (Try generic like 'ibuprofen', 'diclofenac', 'paracetamol')`);
}

async function tryCandidates(candidates, apiKey) {
  for (const c of candidates) {
    try {
      const r = await fetchDrugLabel(c, apiKey);
      return { matched: c, record: r };
    } catch (e) {}
  }
  throw new Error("No matches found from OCR text. Try typing generic name.");
}


export default function MedicineRecognizer({ onBack }) {
  const [medicineName, setMedicineName] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [ocrText, setOcrText] = useState("");

  const [loadingOCR, setLoadingOCR] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState(null);

  const [showFull, setShowFull] = useState({
    usages: false,
    side: false,
    warn: false,
  });

  const workerRef = useRef(null);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate?.();
        workerRef.current = null;
      }
    };
  }, []);

  const runOCR = async () => {
    try {
      setError("");
      setLabel(null);

      if (!imageFile) {
        setError("Please upload an image first.");
        return;
      }

      setLoadingOCR(true);
      setOcrText("");

      if (!workerRef.current) {
        workerRef.current = await createWorker("eng");
      }

      const { data } = await workerRef.current.recognize(previewUrl);
const text = data?.text || "";
setOcrText(text);

// 1) OCR se 1st guess nikalna (optional)
const guessed = pickCandidateName(text);

// 2) Candidates list banani (guessed + kuch extra words)
const tokens = String(text)
  .replace(/[^a-zA-Z0-9\s]/g, " ")
  .split(/\s+/)
  .map(t => t.trim())
  .filter(Boolean);

const candidates = [
  guessed,
  ...tokens.filter(t => /^[a-zA-Z][a-zA-Z0-9-]{2,}$/.test(t)).slice(0, 15),
].filter(Boolean);

// 3) Auto-search: candidates me se jo openFDA pe match ho jaaye, wahi show
setLoadingLabel(true);
try {
  const found = await tryCandidates(candidates, apiKey);
  setMedicineName(found.matched);
  setLabel(found.record);
} finally {
  setLoadingLabel(false);
}

    } catch (e) {
      setError(e?.message || "OCR failed.");
    } finally {
      setLoadingOCR(false);
    }
  };

  const searchLabel = async () => {
    try {
      setError("");
      setLabel(null);
      setShowFull({ usages: false, side: false, warn: false });

      setLoadingLabel(true);
      const out = await fetchDrugLabel(medicineName, apiKey);
      setLabel(out);
    } catch (e) {
      setError(e?.message || "Search failed.");
    } finally {
      setLoadingLabel(false);
    }
  };

  const renderSection = (title, text, keyName) => {
    const s = shortText(text, 380);
    const isOpen = !!showFull[keyName];
    const finalText = isOpen ? text : s.short;

    return (
      <div className="recognizer-block">
        <div className="recognizer-subtitle">{title}</div>
        <pre className="recognizer-pre">{finalText || "Not available in label."}</pre>

        {s.isLong && (
          <button
            className="link-btn"
            type="button"
            onClick={() => setShowFull((p) => ({ ...p, [keyName]: !p[keyName] }))}
          >
            {isOpen ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="recognizer-container">
      <div className="recognizer-card">
        <div className="recognizer-header">
          <h2>Medicine Recognizer</h2>
          <button className="btn-secondary" type="button" onClick={onBack}>
            Back
          </button>
        </div>

        <div className="recognizer-grid">
          <div className="recognizer-panel">
            <div className="input-group">
              <label className="recognizer-label">Medicine name</label>
              <input
                value={medicineName}
                onChange={(e) => setMedicineName(e.target.value)}
                placeholder="e.g., paracetamol / ibuprofen / diclofenac"
              />
            </div>

            <div className="input-group">
              <label className="recognizer-label">openFDA API key (optional)</label>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Optional: api_key"
              />
            </div>

            <div className="recognizer-actions">
              <button
                className="btn-primary"
                type="button"
                onClick={searchLabel}
                disabled={loadingLabel || !medicineName.trim()}
              >
                {loadingLabel ? "Searching..." : "Get usages / side effects"}
              </button>
            </div>

            <div className="recognizer-divider" />

            <div className="input-group">
              <label className="recognizer-label">Upload medicine strip image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              />
            </div>

            <div className="recognizer-actions">
              <button
                className="btn-action"
                type="button"
                onClick={runOCR}
                disabled={loadingOCR || !imageFile}
              >
                {loadingOCR ? "Reading image..." : "Recognize from image (OCR)"}
              </button>
            </div>

            {error ? <div className="recognizer-error">{error}</div> : null}

            {ocrText ? (
              <div className="recognizer-ocr">
                <div className="recognizer-subtitle">OCR extracted text</div>
                <pre className="recognizer-pre">{ocrText.slice(0, 1200)}</pre>
              </div>
            ) : null}
          </div>

          <div className="recognizer-panel">
            {previewUrl ? (
              <>
                <div className="recognizer-subtitle">Image preview</div>
                <img className="recognizer-preview" src={previewUrl} alt="Medicine" />
              </>
            ) : (
              <div className="recognizer-muted">Upload an image to preview here.</div>
            )}

            {label ? (
              <div className="recognizer-result">
                <h3 className="recognizer-result-title">{label.name}</h3>

                {(label.manufacturer || label.route) ? (
                  <div className="recognizer-meta">
                    {label.manufacturer ? <span>Manufacturer: {label.manufacturer}</span> : null}
                    {label.route ? <span>Route: {label.route}</span> : null}
                  </div>
                ) : null}

                {renderSection("Usages / benefits", label.usagesBenefits, "usages")}
                {renderSection("Side effects", label.sideEffects, "side")}
                {renderSection("Harmful for / warnings", label.harmfulFor, "warn")}

                <div className="recognizer-note">
                  Note: This information comes from FDA labels; it is not personal medical advice—check with a doctor/pharmacist.
                </div>
              </div>
            ) : (
              <div className="recognizer-muted">If you search, the details will appear here.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
