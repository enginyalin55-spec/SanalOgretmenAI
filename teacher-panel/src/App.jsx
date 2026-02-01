import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import {
  BarChart2,
  Save,
  Edit3,
  Globe,
  Download,
  LogOut,
  Lock,
  Plus,
  Trash2,
  CheckCircle,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
  Info,
} from "lucide-react";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import html2pdf from "html2pdf.js";

// --- AYARLAR ---
const PASS_THRESHOLD = 70;
const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#ff7675"];
const API_URL = "https://sanalogretmenai.onrender.com";

// --- TDK KURAL SÖZLÜĞÜ (BACKEND İLE %100 UYUMLU) ---
const TDK_LOOKUP = {
  "TDK_01_BAGLAC_DE": "Bağlaç olan 'da/de' ayrı yazılır",
  "TDK_02_BAGLAC_KI": "Bağlaç olan 'ki' ayrı yazılır",
  "TDK_03_SORU_EKI_MI": "Soru eki 'mı/mi' ayrı yazılır",
  "TDK_04_SEY_AYRI": "'Şey' sözcüğü ayrı yazılır",
  "TDK_06_YA_DA": "'Ya da' ayrı yazılır",
  "TDK_07_HER_SEY": "'Her şey' ayrı yazılır",
  "TDK_12_GEREKSIZ_BUYUK": "Gereksiz büyük harf kullanımı",
  "TDK_20_KESME_OZEL_AD": "Özel adlara gelen ekler kesmeyle ayrılır",
  "TDK_23_KESME_GENEL_YOK": "Cins adlara gelen ekler kesmeyle ayrılmaz",
  "TDK_40_COK": "'Çok' kelimesinin yazımı",
  "TDK_41_HERKES": "'Herkes' kelimesinin yazımı",
  "TDK_42_YALNIZ": "'Yalnız' kelimesinin yazımı",
  "TDK_43_YANLIS": "'Yanlış' kelimesinin yazımı",
  "TDK_44_BIRKAC": "'Birkaç' bitişik yazılır",
  "TDK_45_HICBIR": "'Hiçbir' bitişik yazılır",
  "TDK_46_PEKCOK": "'Pek çok' ayrı yazılır",
  "TDK_47_INSALLAH": "'İnşallah' kelimesinin yazımı",
  "TDK_HOS_GELDIN": "'Hoş geldin' ayrı yazılır",
  "TDK_HOS_BULDUK": "'Hoş bulduk' ayrı yazılır"
};

// --- ÜLKE ADLARI / BAYRAK ---
const COUNTRY_NAMES = {
  TR: "Türkiye", US: "ABD", GB: "İngiltere", DE: "Almanya", FR: "Fransa",
  RU: "Rusya", UA: "Ukrayna", AZ: "Azerbaycan", KZ: "Kazakistan", UZ: "Özbekistan",
  TM: "Türkmenistan", KG: "Kırgızistan", AF: "Afganistan", TJ: "Tacikistan", SY: "Suriye",
  IQ: "Irak", IR: "İran", SA: "S. Arabistan", AE: "BAE", QA: "Katar", KW: "Kuveyt",
  LB: "Lübnan", JO: "Ürdün", PS: "Filistin", EG: "Mısır", LY: "Libya", DZ: "Cezayir",
  MA: "Fas", TN: "Tunus", SD: "Sudan", SO: "Somali", YE: "Yemen", CN: "Çin",
  JP: "Japonya", KR: "Güney Kore", IN: "Hindistan", PK: "Pakistan", BD: "Bangladeş",
  ID: "Endonezya", MY: "Malezya", BA: "Bosna Hersek", AL: "Arnavutluk", MK: "Makedonya",
  XK: "Kosova", GR: "Yunanistan", BG: "Bulgaristan", RO: "Romanya",
};

const getFlag = (countryCode) => {
  if (!countryCode || String(countryCode).length !== 2) return "🌍";
  const codePoints = String(countryCode).toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

const generateClassCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();

// --- PUAN EDITOR ---
const ScoreEditor = ({ rubric, onUpdate }) => {
    if (!rubric) return null;

    const handleChange = (key, val, max) => {
        if (val === "") { onUpdate(key, ""); return; }
        let newVal = parseInt(val);
        if (isNaN(newVal)) return;
        if (newVal > max) newVal = max;
        if (newVal < 0) newVal = 0;
        onUpdate(key, newVal);
    };

    const items = [
        { key: "uzunluk", label: "Uzunluk", max: 16 },
        { key: "noktalama", label: "Noktalama", max: 14 },
        { key: "dil_bilgisi", label: "Dil Bilgisi", max: 16 },
        { key: "soz_dizimi", label: "Söz Dizimi", max: 20 },
        { key: "kelime", label: "Kelime", max: 14 },
        { key: "icerik", label: "İçerik", max: 20 },
    ];

    return (
        <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10, marginTop:15, padding:15, backgroundColor:'#f8f9fa', borderRadius:10}}>
            {items.map((item) => (
                <div key={item.key} style={{textAlign:'center', border:'1px solid #eee', padding:5, borderRadius:8, backgroundColor:'white'}}>
                    <div style={{fontSize:10, color:'#7f8c8d', textTransform:'uppercase', fontWeight:'bold', marginBottom:4}}>{item.label}</div>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:2}}>
                        <input 
                            type="number" 
                            value={rubric[item.key] === undefined ? "" : rubric[item.key]} 
                            onChange={(e) => handleChange(item.key, e.target.value, item.max)}
                            style={{width:40, textAlign:'center', fontWeight:'bold', fontSize:16, border:'1px solid #3498db', borderRadius:4, color:'#2c3e50', padding:'2px 0'}}
                        />
                        <span style={{fontSize:11, color:'#bdc3c7'}}>/{item.max}</span>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- HATA POPOVER ---
const ErrorPopover = ({ data, onClose }) => {
  if (!data) return null;
  const { err, x, y } = data;
  const ruleTitle = (err?.rule_id && TDK_LOOKUP[err.rule_id]) || err?.rule_id || err?.type || "Kural İhlali";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.0)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: Math.min((x || 20) - 20, window.innerWidth - 360), top: (y || 20) + 10, width: 340, background: "white", border: "1px solid #e5e7eb", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f0f0f0", paddingBottom: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, color: "#c0392b" }}>⚠️ Hata Detayı</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#95a5a6", fontWeight: 900, fontSize: 16 }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", background: "#f8f9fa", padding: 10, borderRadius: 10, border: "1px solid #f0f0f0", marginBottom: 10 }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#e74c3c" }}>YANLIŞ</div>
            <div style={{ fontWeight: 800, color: "#c0392b" }}><span style={{ textDecoration: "line-through" }}>{err?.wrong || "-"}</span></div>
          </div>
          <div style={{ color: "#bdc3c7", fontSize: 18 }}>➜</div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#27ae60" }}>DOĞRU</div>
            <div style={{ fontWeight: 800, color: "#27ae60" }}>{err?.correct || "-"}</div>
          </div>
        </div>
        <div style={{ background: "#e8f0fe", borderLeft: "4px solid #3498db", padding: 10, borderRadius: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#2980b9", fontWeight: 800, letterSpacing: 0.8 }}>KURAL</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#2c3e50" }}>{ruleTitle}</div>
        </div>
        <div style={{ fontSize: 13, color: "#636e72", lineHeight: 1.5 }}>{err?.explanation || "Açıklama yok."}</div>
      </div>
    </div>
  );
};

// --- HIGHLIGHT (HATA BİRLEŞTİRMELİ) ---
const HighlightedText = ({ text, errors, onErrorClick }) => {
  if (!text) return null;
  // Hata listesi dizi değilse boş dizi yap
  const safeErrors = Array.isArray(errors) ? errors : [];

  if (safeErrors.length === 0) {
    return <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>;
  }

  // Span tabanlı hataları sırala
  const spanErrors = safeErrors
    .filter((e) => e?.span?.start !== undefined && e?.span?.end !== undefined)
    .sort((a, b) => a.span.start - b.span.start);

  if (spanErrors.length > 0) {
    const out = [];
    let cursor = 0;

    spanErrors.forEach((err, idx) => {
      const start = Math.max(0, err.span.start);
      const end = Math.min(text.length, err.span.end);
      if (start >= end || start < cursor) return;

      if (start > cursor) out.push(<span key={`t-${idx}-${cursor}`}>{text.slice(cursor, start)}</span>);

      const ruleTitle = (err?.rule_id && TDK_LOOKUP[err.rule_id]) || err?.rule_id || err?.type || "Kural";
      const isSuspect = err.severity === "SUSPECT" || err.suggestion_type === "FLAG";

      out.push(
        <span
          key={`e-${idx}`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onErrorClick?.(err, { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY });
          }}
          title={`❌ Yanlış: ${err.wrong || "-"}\n✅ Doğru: ${err.correct || "-"}\n📌 Kural: ${ruleTitle}\n💡 ${err.explanation || ""}`}
          style={{
            backgroundColor: isSuspect ? "#fff7ed" : "#fff0f0", // Turuncu veya Kırmızı zemin
            color: isSuspect ? "#d35400" : "#c0392b", // Turuncu veya Kırmızı yazı
            fontWeight: 800,
            borderBottom: `2px solid ${isSuspect ? "#e67e22" : "#e74c3c"}`,
            cursor: "pointer",
            borderRadius: 4,
            padding: "0 2px",
          }}
        >
          {text.slice(start, end)}
        </span>
      );

      cursor = end;
    });

    if (cursor < text.length) out.push(<span key="t-end">{text.slice(cursor)}</span>);

    return <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}>{out}</div>;
  }

  return <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>;
};

// --- FOTOĞRAF MODAL ---
const ImageViewerModal = ({ src, onClose }) => {
  const [scale, setScale] = useState(1);
  const handleWheel = (e) => { e.preventDefault(); const newScale = scale - e.deltaY * 0.002; setScale(Math.min(Math.max(0.5, newScale), 5)); };
  if (!src) return null;
  return (
    <div onWheel={handleWheel} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.95)", zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      <div style={{ position: "absolute", top: 20, right: 20, display: "flex", gap: 15, zIndex: 10000 }}>
        <button onClick={() => setScale(scale > 1 ? 1 : 2.5)} style={{ backgroundColor: "white", borderRadius: "50%", width: 50, height: 50, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{scale > 1 ? <ZoomOut /> : <ZoomIn />}</button>
        <button onClick={onClose} style={{ backgroundColor: "#e74c3c", color: "white", borderRadius: "50%", width: 50, height: 50, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X /></button>
      </div>
      <div style={{ overflow: "auto", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <img src={src} alt="Ödev" style={{ maxWidth: scale <= 1 ? "100%" : "none", transform: `scale(${scale})`, transition: "transform 0.1s ease-out" }} />
      </div>
    </div>
  );
};

// --- APP ---
export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [aiInsight, setAiInsight] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassCode, setSelectedClassCode] = useState("ALL");
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [isEditingClass, setIsEditingClass] = useState(false);
  const [editClassName, setEditClassName] = useState("");
  const [submissions, setSubmissions] = useState([]);
  const [filteredSubmissions, setFilteredSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [activeError, setActiveError] = useState(null);
  const [editableRubric, setEditableRubric] = useState(null);
  const [calculatedTotal, setCalculatedTotal] = useState(0);
  const [isScoreChanged, setIsScoreChanged] = useState(false);
  const [teacherNote, setTeacherNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [chartData, setChartData] = useState([]);
  const [countryData, setCountryData] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session || null);
      supabase.auth.onAuthStateChange((_event, sess) => setSession(sess || null));
    };
    init();
  }, []);

  useEffect(() => {
    if (session) { fetchClassrooms(); fetchSubmissions(); } 
    else { setClassrooms([]); setSubmissions([]); setFilteredSubmissions([]); setSelectedSubmission(null); }
  }, [session]);

  useEffect(() => {
    if (selectedClassCode === "ALL") { setFilteredSubmissions(submissions); calculateStats(submissions); setIsEditingClass(false); }
    else { const filtered = submissions.filter((sub) => sub.classroom_code === selectedClassCode); setFilteredSubmissions(filtered); calculateStats(filtered); }
  }, [selectedClassCode, submissions]);

  // --- VERİ YÜKLEME ---
  useEffect(() => {
      if (selectedSubmission) {
          setTeacherNote(selectedSubmission.human_note || "");
          const note = selectedSubmission.analysis_json?.teacher_note || selectedSubmission.analysis_json?.ai_insight || "YZ analizi bulunamadı.";
          setAiInsight(note);

          const rawRubric = selectedSubmission.analysis_json?.rubric || selectedSubmission.analysis_json?.scores || {};
          let mappedRubric = { uzunluk: 0, noktalama: 0, dil_bilgisi: 0, soz_dizimi: 0, kelime: 0, icerik: 0 };

          Object.keys(rawRubric).forEach(key => {
              const val = parseInt(rawRubric[key]) || 0;
              const k = key.toLowerCase();
              if (k.includes("uzun") || k.includes("len")) mappedRubric.uzunluk = val;
              else if (k.includes("nokta") || k.includes("pun")) mappedRubric.noktalama = val;
              else if (k.includes("dil") || k.includes("gra")) mappedRubric.dil_bilgisi = val;
              else if (k.includes("söz") || k.includes("syn")) mappedRubric.soz_dizimi = val;
              else if (k.includes("keli") || k.includes("voc")) mappedRubric.kelime = val;
              else if (k.includes("içer") || k.includes("con")) mappedRubric.icerik = val;
          });

          setEditableRubric(mappedRubric);
          const total = (selectedSubmission.score_total !== null && selectedSubmission.score_total !== undefined) ? Number(selectedSubmission.score_total) : Object.values(mappedRubric).reduce((a, b) => a + b, 0);
          setCalculatedTotal(total);
          setIsScoreChanged(false);
          setActiveError(null);
      }
  }, [selectedSubmission]);

  async function fetchClassrooms() { const { data } = await supabase.from("classrooms").select("*").eq("teacher_email", session.user.email); setClassrooms(data || []); }
  async function fetchSubmissions() { const { data } = await supabase.from("submissions").select("*").order("created_at", { ascending: false }); setSubmissions(data || []); }
  async function createClassroom() { if (!newClassName) return; const code = generateClassCode(); await supabase.from("classrooms").insert([{ name: newClassName, code, teacher_email: session.user.email }]); setNewClassName(""); setShowCreateClass(false); fetchClassrooms(); }
  async function updateClassroom() { if (!editClassName) return; await supabase.from("classrooms").update({ name: editClassName }).eq("code", selectedClassCode); setIsEditingClass(false); fetchClassrooms(); }
  async function deleteClassroom() { if (window.confirm("Silinsin mi?")) { await supabase.from("classrooms").delete().eq("code", selectedClassCode); setSelectedClassCode("ALL"); fetchClassrooms(); fetchSubmissions(); } }
  async function deleteSubmission(id) { if (window.confirm("Silinsin mi?")) { await supabase.from("submissions").delete().eq("id", id); setSubmissions(submissions.filter(s => s.id !== id)); setSelectedSubmission(null); } }
  const handleLogin = async (e) => { e.preventDefault(); setLoading(true); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); setLoading(false); };
  const handleLogout = async () => { await supabase.auth.signOut(); setSubmissions([]); setClassrooms([]); setSelectedSubmission(null); };

  const handleRubricUpdate = (key, value) => {
      const valToStore = value === "" ? "" : parseInt(value);
      const newRubric = { ...editableRubric, [key]: valToStore };
      setEditableRubric(newRubric);
      const total = Object.values(newRubric).reduce((a, b) => a + (Number(b) || 0), 0);
      setCalculatedTotal(total);
      setIsScoreChanged(true);
  };

  // ✅ PUAN GÜNCELLEME (DÜZELTİLDİ)
  async function saveUpdatedScore() {
    if (!selectedSubmission) return;
    setIsSaving(true);

    let backendOk = false;
    try {
      const r = await fetch(`${API_URL}/update-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: selectedSubmission.id,
          new_rubric: editableRubric, // SADECE RUBRIC OBJE
          new_total: calculatedTotal,
        }),
      });
      backendOk = r.ok;
    } catch (_e) { backendOk = false; }

    if (!backendOk) {
        const fullJson = { ...(selectedSubmission.analysis_json || {}), rubric: editableRubric };
        const { error } = await supabase.from("submissions").update({ score_total: calculatedTotal, analysis_json: fullJson }).eq("id", selectedSubmission.id);
        if (error) { alert("Hata: " + error.message); setIsSaving(false); return; }
    }

    const updatedSubmissions = submissions.map((sub) => sub.id === selectedSubmission.id ? { ...sub, score_total: calculatedTotal, analysis_json: { ...sub.analysis_json, rubric: editableRubric } } : sub);
    setSubmissions(updatedSubmissions);
    setSelectedSubmission({ ...selectedSubmission, score_total: calculatedTotal, analysis_json: { ...selectedSubmission.analysis_json, rubric: editableRubric } });
    alert("✅ Puan güncellendi!");
    setIsScoreChanged(false);
    setIsSaving(false);
  }

  async function saveTeacherNote() {
    if (!selectedSubmission) return;
    setIsSaving(true);
    await supabase.from("submissions").update({ human_note: teacherNote }).eq("id", selectedSubmission.id);
    const updated = submissions.map((sub) => (sub.id === selectedSubmission.id ? { ...sub, human_note: teacherNote } : sub));
    setSubmissions(updated);
    setSelectedSubmission({ ...selectedSubmission, human_note: teacherNote });
    alert("✅ Not kaydedildi!");
    setIsSaving(false);
  }

  function calculateStats(data) {
    let stats = { Dilbilgisi: 0, "Söz Dizimi": 0, "Yazım/Nokt.": 0, Kelime: 0 };
    let countries = {};
    data.forEach((sub) => {
      // HATA BİRLEŞTİRME (İSTATİSTİK İÇİN)
      const list1 = sub.analysis_json?.errors_student || [];
      const list2 = sub.analysis_json?.errors_ocr || [];
      const list3 = sub.analysis_json?.errors || [];
      const allErrs = [...list1, ...list2, ...list3];

      allErrs.forEach((err) => {
        const t = String(err?.type || err?.rule_id || "").toLowerCase();
        if (t.includes("söz") || t.includes("cümle")) stats["Söz Dizimi"]++;
        else if (t.includes("yazım") || t.includes("nokta") || t.includes("büyük")) stats["Yazım/Nokt."]++;
        else if (t.includes("kelime")) stats["Kelime"]++;
        else stats["Dilbilgisi"]++;
      });
      const c = sub.country || "Belirsiz";
      countries[c] = (countries[c] || 0) + 1;
    });
    setChartData(Object.keys(stats).map((key) => ({ name: key, HataSayisi: stats[key] })));
    setCountryData(Object.keys(countries).map((key) => ({ name: key, value: countries[key] })));
  }

  const globalStyles = `
    input, select, textarea { background-color: #ffffff !important; color: #000000 !important; border: 1px solid #cccccc !important; }
    .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }
    .force-hide { display:none !important; }
  `;

  const downloadPDF = async () => {
    const source = document.getElementById("report-content");
    if (!source || !selectedSubmission) return;
    const fileName = `Rapor_${selectedSubmission.student_name}_${selectedSubmission.student_surname}.pdf`;
    const clone = source.cloneNode(true);
    clone.classList.add("pdf-mode");
    
    // Textarea value fix
    const originalTextArea = source.querySelector("textarea");
    const cloneTextArea = clone.querySelector("textarea");
    if (originalTextArea && cloneTextArea) {
        cloneTextArea.value = originalTextArea.value;
        cloneTextArea.innerHTML = originalTextArea.value;
    }

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed"; wrapper.style.left = "-10000px"; wrapper.style.background = "white";
    const style = document.createElement("style");
    style.innerHTML = `
      .pdf-mode { font-family: Arial, sans-serif !important; width: 720px !important; padding: 20px !important; }
      .pdf-mode * { max-width: 100% !important; }
      .pdf-mode .ai-box { display: none !important; } 
      .pdf-mode button { display: none !important; }
      .pdf-mode textarea { border: 1px solid #ccc !important; min-height: 100px !important; resize: none !important; }
    `;
    wrapper.appendChild(style);
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    const opt = { margin: 10, filename: fileName, image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } };
    await html2pdf().set(opt).from(clone).save();
    document.body.removeChild(wrapper);
  };

  if (!session) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", backgroundColor: "#f0f2f5" }}>
        <div style={{ backgroundColor: "white", padding: 40, borderRadius: 15, boxShadow: "0 10px 25px rgba(0,0,0,0.05)", width: 350, textAlign: "center" }}>
            <h2>Öğretmen Girişi</h2>
            <form onSubmit={handleLogin}>
                <input type="email" placeholder="E-posta" value={email} onChange={(e)=>setEmail(e.target.value)} style={{width:"100%", padding:12, marginBottom:15}} required />
                <input type="password" placeholder="Şifre" value={password} onChange={(e)=>setPassword(e.target.value)} style={{width:"100%", padding:12, marginBottom:25}} required />
                <button type="submit" disabled={loading} style={{width:"100%", padding:12, backgroundColor:"#3498db", color:"white", border:"none", borderRadius:8, cursor:"pointer"}}>{loading?"...":"Giriş Yap"}</button>
            </form>
        </div>
    </div>
  );

  // --- HATA LİSTESİ BİRLEŞTİRME (RENDER İÇİN) ---
  const getCombinedErrorsForRender = (sub) => {
      if(!sub || !sub.analysis_json) return [];
      const l1 = sub.analysis_json.errors_student || [];
      const l2 = sub.analysis_json.errors_ocr || [];
      const l3 = sub.analysis_json.errors || [];
      return [...l1, ...l2, ...l3];
  };

  if (!selectedSubmission) {
    return (
      <div style={{ padding: "30px", backgroundColor: "#f4f6f8", minHeight: "100vh", fontFamily: "Segoe UI" }}>
        <style>{globalStyles}</style>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 25 }}>
            <h1>🎓 Öğretmen Paneli</h1>
            <button onClick={handleLogout} style={{ backgroundColor: "#e74c3c", color: "white", border: "none", padding: "8px 15px", borderRadius: 10, cursor: "pointer" }}><LogOut size={16}/> Çıkış</button>
        </div>

        {/* Dashboard Filtreler vb. */}
        <div style={{ backgroundColor: "white", padding: 15, borderRadius: 12, marginBottom: 25, display: "flex", gap: 15 }}>
            <select value={selectedClassCode} onChange={(e)=>setSelectedClassCode(e.target.value)} style={{ padding: 8, borderRadius: 6 }}>
                <option value="ALL">Tüm Sınıflar</option>
                {classrooms.map(c=><option key={c.id} value={c.code}>{c.name}</option>)}
            </select>
            {/* ... Diğer butonlar (Kısaltıldı ama işlevler yukarıda tanımlı) ... */}
        </div>

        {/* Tablo */}
        <div style={{ backgroundColor: "white", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ backgroundColor: "#fafafa", textAlign: "left" }}><th style={{padding:15}}>Tarih</th><th style={{padding:15}}>Öğrenci</th><th style={{padding:15}}>Puan</th><th style={{padding:15}}>İşlem</th></tr></thead>
                <tbody>
                    {filteredSubmissions.map(sub => (
                        <tr key={sub.id} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{padding:15}}>{new Date(sub.created_at).toLocaleDateString("tr-TR")}</td>
                            <td style={{padding:15}}>{sub.student_name} {sub.student_surname}</td>
                            <td style={{padding:15}}><span style={{ backgroundColor: sub.score_total>=70?"#e8f8f5":"#fdedec", color: sub.score_total>=70?"#27ae60":"#c0392b", padding:"5px 10px", borderRadius:15, fontWeight:"bold" }}>{sub.score_total}</span></td>
                            <td style={{padding:15}}><button onClick={()=>setSelectedSubmission(sub)} style={{ backgroundColor:"#34495e", color:"white", border:"none", padding:"8px 15px", borderRadius:6, cursor:"pointer" }}>İncele</button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      </div>
    );
  }

  // --- DETAY GÖRÜNÜM ---
  const combinedErrors = getCombinedErrorsForRender(selectedSubmission);

  return (
    <div style={{ padding: "30px", backgroundColor: "#f4f6f8", minHeight: "100vh", fontFamily: "Segoe UI" }}>
      <style>{globalStyles}</style>
      <div style={{ marginBottom: 20, display:"flex", justifyContent:"space-between" }}>
          <button onClick={()=>setSelectedSubmission(null)} style={{ border:"none", background:"none", color:"#3498db", fontWeight:"bold", cursor:"pointer" }}>← Geri Dön</button>
          <button onClick={downloadPDF} style={{ backgroundColor:"#2c3e50", color:"white", padding:"10px 20px", borderRadius:8, border:"none", cursor:"pointer" }}>PDF İndir</button>
      </div>

      <div id="report-content" style={{ display:"flex", gap:25, flexDirection: window.innerWidth < 1100 ? "column" : "row" }}>
          {/* Sol: Resim */}
          <div style={{ flex:1 }} className="avoid-break">
              <div style={{ backgroundColor:"white", padding:20, borderRadius:12 }}>
                  <h3>📄 Öğrenci Kağıdı</h3>
                  <div style={{ width:"100%", height:400, backgroundColor:"#f8f9fa", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                      <img src={selectedSubmission.image_url} alt="Ödev" style={{ width:"100%", height:"100%", objectFit:"contain" }} onClick={()=>setShowImageModal(true)} />
                  </div>
              </div>
          </div>

          {/* Orta: Metin */}
          <div style={{ flex:1 }} className="avoid-break">
              <div style={{ backgroundColor:"white", padding:20, borderRadius:12 }}>
                  <h3>📝 Dijital Metin</h3>
                  <div style={{ backgroundColor:"#f8f9fa", padding:20, borderRadius:8, lineHeight:1.6 }}>
                      <HighlightedText text={selectedSubmission.ocr_text} errors={combinedErrors} onErrorClick={(err, coords)=>setActiveError({err, ...coords})} />
                  </div>
              </div>
              
              <div className="ai-box" style={{ backgroundColor:"white", padding:20, borderRadius:12, marginTop:20, borderLeft:"5px solid #ffc107" }}>
                  <strong style={{ color:"#d35400", display:"block", marginBottom:5 }}>🤖 YZ Analizi</strong>
                  {aiInsight}
              </div>

              <div style={{ backgroundColor:"white", padding:20, borderRadius:12, marginTop:20, borderLeft:"5px solid #3498db" }}>
                  <strong style={{ color:"#2980b9", display:"block", marginBottom:5 }}>Öğretmen Değerlendirmesi</strong>
                  <textarea value={teacherNote} onChange={(e)=>setTeacherNote(e.target.value)} style={{ width:"100%", height:100, padding:10, borderRadius:8, borderColor:"#ddd" }} placeholder="Notunuzu yazın..." />
                  <button onClick={saveTeacherNote} disabled={isSaving} style={{ marginTop:10, backgroundColor:"#3498db", color:"white", border:"none", padding:"8px 15px", borderRadius:5, cursor:"pointer", float:"right" }}>{isSaving?"...":"Kaydet"}</button>
                  <div style={{clear:"both"}}></div>
              </div>
          </div>

          {/* Sağ: Puan & Liste */}
          <div style={{ flex:1 }} className="avoid-break">
              <div style={{ backgroundColor:"white", padding:20, borderRadius:12, textAlign:"center", marginBottom:20 }}>
                  <div style={{ fontSize:12, color:"#95a5a6", fontWeight:"bold" }}>PUAN</div>
                  <div style={{ fontSize:64, fontWeight:"800", color: calculatedTotal>=70?"#27ae60":"#e74c3c" }}>{calculatedTotal}</div>
                  {isScoreChanged && <button onClick={saveUpdatedScore} style={{ backgroundColor:"#e67e22", color:"white", border:"none", padding:"8px 15px", borderRadius:20, cursor:"pointer", fontWeight:"bold" }}>Kaydet</button>}
                  <ScoreEditor rubric={editableRubric} onUpdate={handleRubricUpdate} />
              </div>

              <div style={{ backgroundColor:"white", padding:20, borderRadius:12 }}>
                  <h3>Hatalar ({combinedErrors.length})</h3>
                  {combinedErrors.map((err, i) => {
                      const ruleTitle = (err?.rule_id && TDK_LOOKUP[err.rule_id]) || err?.rule_id || "Kural";
                      const isSuspect = err.severity === "SUSPECT" || err.suggestion_type === "FLAG";
                      return (
                          <div key={i} style={{ marginBottom:15, borderBottom:"1px solid #eee", paddingBottom:10 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:5 }}>
                                  <span style={{ textDecoration:"line-through", color: isSuspect?"#d35400":"#e74c3c", backgroundColor: isSuspect?"#fff7ed":"#fff0f0", padding:"2px 5px", borderRadius:4 }}>{err.wrong}</span>
                                  <span>➜</span>
                                  <span style={{ fontWeight:"bold", color: isSuspect?"#e67e22":"#27ae60" }}>{err.correct || "?"}</span>
                              </div>
                              <div style={{ fontSize:12, color:"#7f8c8d" }}>📌 {ruleTitle}</div>
                              {isSuspect && <div style={{ fontSize:11, color:"#d35400", fontWeight:"bold" }}>⚠️ ŞÜPHELİ</div>}
                          </div>
                      );
                  })}
              </div>
          </div>
      </div>

      {showImageModal && <ImageViewerModal src={selectedSubmission.image_url} onClose={()=>setShowImageModal(false)} />}
      <ErrorPopover data={activeError} onClose={()=>setActiveError(null)} />
    </div>
  );
}