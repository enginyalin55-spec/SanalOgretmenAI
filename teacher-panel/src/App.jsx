import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { BarChart2, Save, Edit3, Globe, Download, LogOut, Lock, Plus, Trash2, CheckCircle, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import html2pdf from 'html2pdf.js';

// --- AYARLAR ---
const PASS_THRESHOLD = 70; 
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#ff7675'];
// DİKKAT: Backend adresini kendi sunucunuza göre ayarlayın
const API_URL = "https://sanalogretmenai.onrender.com"; 

const COUNTRY_NAMES = {
  "TR": "Türkiye", "US": "ABD", "GB": "İngiltere", "DE": "Almanya", "FR": "Fransa",
  "RU": "Rusya", "UA": "Ukrayna", "AZ": "Azerbaycan", "KZ": "Kazakistan", "UZ": "Özbekistan",
  "TM": "Türkmenistan", "KG": "Kırgızistan", "AF": "Afganistan", "TJ": "Tacikistan",
  "SY": "Suriye", "IQ": "Irak", "IR": "İran", "SA": "S. Arabistan", "AE": "BAE", 
  "QA": "Katar", "KW": "Kuveyt", "LB": "Lübnan", "JO": "Ürdün", "PS": "Filistin", 
  "EG": "Mısır", "LY": "Libya", "DZ": "Cezayir", "MA": "Fas", "TN": "Tunus", 
  "SD": "Sudan", "SO": "Somali", "YE": "Yemen", "CN": "Çin", "JP": "Japonya", 
  "KR": "Güney Kore", "IN": "Hindistan", "PK": "Pakistan", "BD": "Bangladeş", 
  "ID": "Endonezya", "MY": "Malezya", "BA": "Bosna Hersek", "AL": "Arnavutluk", 
  "MK": "Makedonya", "XK": "Kosova", "GR": "Yunanistan", "BG": "Bulgaristan", "RO": "Romanya"
};

const getFlag = (countryCode) => {
  if (!countryCode || countryCode.length !== 2) return '🌍';
  const codePoints = countryCode.toUpperCase().split('').map(char =>  127397 + char.charCodeAt());
  return String.fromCodePoint(...codePoints);
}

const generateClassCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();

// --- TDK KURAL SÖZLÜĞÜ ---
const TDK_LOOKUP = {
  "TDK_01_BAGLAC_DE": "Bağlaç Olan 'da/de'nin Yazımı",
  "TDK_02_BAGLAC_KI": "Bağlaç Olan 'ki'nin Yazımı",
  "TDK_03_SORU_EKI": "Soru Eki 'mı/mi'nin Yazımı",
  "TDK_04_SEY_SOZ": "'Şey' Sözcüğünün Yazımı",
  "TDK_05_BUYUK_CUMLE": "Cümle Başı Büyük Harf",
  "TDK_06_BUYUK_OZEL": "Özel İsimlerin Yazımı",
  "TDK_07_BUYUK_KURUM": "Kurum ve Kuruluş Adları",
  "TDK_08_TARIH_GUN_AY": "Belirli Tarihlerin Yazımı",
  "TDK_09_KESME_OZEL": "Özel İsimlere Gelen Ekler",
  "TDK_10_KESME_KURUM": "Kurum Adlarına Gelen Ekler",
  "TDK_11_YARDIMCI_FIIL_SES": "Yardımcı Fiillerde Ses Olayı",
  "TDK_12_SAYI_AYRI": "Sayıların Yazımı (Ayrı)",
  "TDK_13_ULESTIRME": "Üleştirme Sayıları",
  "TDK_14_KISALTMA_BUYUK": "Büyük Harfli Kısaltmalar",
  "TDK_15_IKILEMELER": "İkilemelerin Yazımı",
  "TDK_16_PEKISTIRME": "Pekiştirmelerin Yazımı",
  "TDK_17_YUMUSAK_G": "Yumuşak G Başlangıcı",
  "TDK_18_HER_BIR": "'Her' Kelimesinin Yazımı",
  "TDK_19_BELIRSIZLIK_SIFATLARI": "Belirsizlik Sıfatları",
  "TDK_20_NOKTA": "Nokta Kullanımı",
  "TDK_21_VIRGUL": "Virgül Kullanımı",
  "TDK_22_DARALMA_KURALI": "Gereksiz Ünlü Daralması (Yazı Dili)",
  "TDK_23_YANLIS_YALNIZ": "Yanlış/Yalnız Yazımı",
  "TDK_24_HERKES": "Herkes (s/z) Yazımı",
  "TDK_25_SERTLESME": "Ünsüz Benzeşmesi (Sertleşme)",
  "TDK_26_HANE": "Hane Kelimesinin Yazımı",
  "TDK_27_ART_ARDA": "Art Arda Yazımı",
  "TDK_28_YABANCI_KELIMELER": "Yabancı Kelimelerin Yazımı",
  "TDK_29_UNVANLAR": "Unvanların Yazımı",
  "TDK_30_YONLER": "Yön Adlarının Yazımı"
};

// --- GLOBAL STYLES ---
const GLOBAL_STYLES = `
  .tdk-err {
    background-color: #fff0f0;
    color: #c0392b;
    font-weight: 700;
    border-bottom: 2px solid #e74c3c;
    cursor: pointer;
    border-radius: 3px;
    padding: 0 2px;
    transition: all 0.2s ease;
  }
  .tdk-err:hover, .tdk-err:focus {
    background-color: #ffe1e1;
    outline: none;
  }
  /* WOW EFEKTİ: Hata Tıklandığında Parlama */
  @keyframes flash-highlight {
    0% { background-color: #fff0f0; transform: scale(1); }
    50% { background-color: #ffeaa7; transform: scale(1.05); box-shadow: 0 0 10px rgba(253, 203, 110, 0.5); }
    100% { background-color: #fff0f0; transform: scale(1); }
  }
  .flash-active {
    animation: flash-highlight 0.6s ease-in-out;
  }
`;

// --- PUAN KARTI ---
const ScoreEditor = ({ rubric, onUpdate }) => {
    if (!rubric) return null;
    const handleChange = (key, val, max) => {
        let newVal = parseInt(val);
        if (isNaN(newVal)) newVal = 0; if (newVal > max) newVal = max; if (newVal < 0) newVal = 0;
        onUpdate(key, newVal);
    };
    const items = [
        { key: "uzunluk", label: "Uzunluk", max: 16 }, { key: "noktalama", label: "Noktalama", max: 14 },
        { key: "dil_bilgisi", label: "Dil Bilgisi", max: 16 }, { key: "soz_dizimi", label: "Söz Dizimi", max: 20 },
        { key: "kelime", label: "Kelime", max: 14 }, { key: "icerik", label: "İçerik", max: 20 },
    ];
    return (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(100px, 1fr))', gap:10, marginTop:15, padding:15, backgroundColor:'#f8f9fa', borderRadius:10}}>
            {items.map((item) => (
                <div key={item.key} style={{textAlign:'center', border:'1px solid #eee', padding:5, borderRadius:8, backgroundColor:'white'}}>
                    <div style={{fontSize:10, color:'#7f8c8d', textTransform:'uppercase', fontWeight:'bold', marginBottom:4}}>{item.label}</div>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:2}}>
                        <input type="number" value={rubric[item.key] || 0} onChange={(e) => handleChange(item.key, e.target.value, item.max)}
                            style={{width:40, textAlign:'center', fontWeight:'bold', fontSize:16, border:'1px solid #3498db', borderRadius:4, color:'#2c3e50', padding:'2px 0'}} />
                        <span style={{fontSize:11, color:'#bdc3c7'}}>/{item.max}</span>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- ZIRHLI BOYAMA BİLEŞENİ (FİNAL) ---
const HighlightedText = ({ text, errors, onErrorClick }) => {
  if (typeof text !== "string" || text.length === 0) return null;

  const safeErrors = Array.isArray(errors)
    ? errors.filter((e) => {
          const s = e?.span?.start;
          const ed = e?.span?.end;
          return Number.isInteger(s) && Number.isInteger(ed) && s >= 0 && ed > s && ed <= text.length;
        })
        .slice()
        .sort((a, b) => {
          const ds = a.span.start - b.span.start;
          if (ds !== 0) return ds;
          return (b.span.end - b.span.start) - (a.span.end - a.span.start);
        })
    : [];

  if (safeErrors.length === 0) return <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>;

  const elements = [];
  let cursor = 0;

  for (let i = 0; i < safeErrors.length; i++) {
    const err = safeErrors[i];
    const start = err.span.start;
    const end = err.span.end;

    if (start < cursor) continue;

    if (start > cursor) elements.push(<span key={`txt-${cursor}-${start}`}>{text.slice(cursor, start)}</span>);

    // ID GÜVENLİĞİ: start-end ikilisi ile benzersiz ID
    elements.push(
      <span
        key={`err-${start}-${end}-${err.rule_id || "TDK"}`}
        id={`err-span-${start}-${end}`} 
        className="tdk-err"
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onErrorClick?.(err); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onErrorClick?.(err); } }}
        title="Detay için tıklayın"
      >
        {text.slice(start, end)}
      </span>
    );
    cursor = end;
  }

  if (cursor < text.length) elements.push(<span key={`txt-${cursor}-end`}>{text.slice(cursor)}</span>);

  return <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.8" }}>{elements}</div>;
};

// --- HATA MÜFETTİŞİ KARTI (FİNAL) ---
const ErrorInspector = ({ error, onClose }) => {
  if (!error) return null;
  const ruleTitle = TDK_LOOKUP[error.rule_id] || error.rule_id || "Genel Kural";

  return (
    <div style={{
        position: "fixed", bottom: 30, right: 30, width: 340, backgroundColor: "white", borderRadius: 12, 
        boxShadow: "0 10px 40px rgba(0,0,0,0.25)", border: "1px solid #eee", zIndex: 9999, overflow: "hidden",
        animation: "slideIn 0.25s cubic-bezier(0.18, 0.89, 0.32, 1.28)", fontFamily: "'Segoe UI', sans-serif"
    }}>
      <style>{`@keyframes slideIn { from { transform: translateY(60px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }`}</style>
      <div style={{ backgroundColor: "#e74c3c", color: "white", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>⚠️ HATA DETAYI</div>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "white", cursor: "pointer", width: 28, height: 28, borderRadius: 6, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 15 }}>
            <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 11, color: "#95a5a6", fontWeight: 800, marginBottom: 4 }}>YANLIŞ</div>
                <div style={{ color: "#e74c3c", fontWeight: 800, textDecoration: "line-through", fontSize: 16, wordBreak:'break-word' }}>{error.wrong || "-"}</div>
            </div>
            <div style={{ color: "#bdc3c7", fontSize: 20 }}>➜</div>
            <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 11, color: "#95a5a6", fontWeight: 800, marginBottom: 4 }}>DOĞRU</div>
                <div style={{ color: "#27ae60", fontWeight: 800, fontSize: 16, wordBreak:'break-word' }}>{error.correct || "-"}</div>
            </div>
        </div>
        <div style={{ backgroundColor: "#f8f9fa", padding: 12, borderRadius: 8, marginBottom: 12, borderLeft: "4px solid #3498db" }}>
            <div style={{ fontSize: 10, color: "#3498db", fontWeight: 800, letterSpacing: 0.5, textTransform:'uppercase' }}>İHLAL EDİLEN KURAL</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#2c3e50", marginTop: 4 }}>{ruleTitle}</div>
            <div style={{ fontSize: 11, color: "#7f8c8d", marginTop: 2, fontFamily:'monospace' }}>{error.rule_id}</div>
        </div>
        <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>{error.explanation || "Açıklama bulunamadı."}</div>
      </div>
    </div>
  );
};

// --- RESİM MODAL ---
const ImageViewerModal = ({ src, onClose }) => {
    const [scale, setScale] = useState(1);
    const handleWheel = (e) => { e.preventDefault(); setScale(Math.min(Math.max(0.5, scale - e.deltaY * 0.002), 5)); };
    if (!src) return null;
    return (
        <div onWheel={handleWheel} style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column'}}>
            <div style={{position: 'absolute', top: 20, right: 20, display:'flex', gap:15, zIndex: 10000}}>
                 <button onClick={() => setScale(scale > 1 ? 1 : 2.5)} style={{backgroundColor: 'white', borderRadius:'50%', width:50, height:50, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', border:'none'}}>{scale > 1 ? <ZoomOut/> : <ZoomIn/>}</button>
                 <button onClick={onClose} style={{backgroundColor: '#e74c3c', color:'white', borderRadius:'50%', width:50, height:50, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', border:'none'}}><X/></button>
            </div>
            <div style={{overflow: 'auto', width: '100%', height: '100%', display: 'flex', alignItems: scale > 1 ? 'flex-start' : 'center', justifyContent: scale > 1 ? 'flex-start' : 'center', padding: 20}}>
                <img src={src} style={{maxWidth: scale <= 1 ? '100%' : 'none', maxHeight: scale <= 1 ? '100%' : 'none', transform: `scale(${scale})`, transformOrigin: 'top left', transition: 'transform 0.1s ease-out'}} />
            </div>
        </div>
    )
}

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
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
  const [editableRubric, setEditableRubric] = useState(null);
  const [calculatedTotal, setCalculatedTotal] = useState(0);
  const [isScoreChanged, setIsScoreChanged] = useState(false);
  const [chartData, setChartData] = useState([]);
  const [countryData, setCountryData] = useState([]);
  const [teacherNote, setTeacherNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [activeError, setActiveError] = useState(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ESC TUŞU İLE HER ŞEYİ KAPATMA (Jüri Cilası)
  useEffect(() => {
    const onKey = (e) => { 
        if (e.key === "Escape") {
            setActiveError(null);      // Kartı kapat
            setShowImageModal(false);  // Resmi kapat
        }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const initSession = async () => { await supabase.auth.signOut(); setSession(null); };
    initSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) { fetchClassrooms(); fetchSubmissions(); } }, [session]);

  useEffect(() => {
    if (selectedClassCode === "ALL") {
      setFilteredSubmissions(submissions);
      calculateStats(submissions);
      setIsEditingClass(false); 
    } else {
      const filtered = submissions.filter(sub => sub.classroom_code === selectedClassCode);
      setFilteredSubmissions(filtered);
      calculateStats(filtered);
    }
  }, [selectedClassCode, submissions]);

  // ID tabanlı useEffect (Performans Fix)
  useEffect(() => {
      if (selectedSubmission) {
          setTeacherNote(selectedSubmission.human_note || "");
          const rubric = selectedSubmission.analysis_json?.rubric || {uzunluk:0, noktalama:0, dil_bilgisi:0, soz_dizimi:0, kelime:0, icerik:0};
          setEditableRubric({...rubric});
          setCalculatedTotal(selectedSubmission.score_total);
          setIsScoreChanged(false);
          setActiveError(null);
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
  }, [selectedSubmission?.id]);

  const handleRubricUpdate = (key, value) => {
      const newRubric = { ...editableRubric, [key]: value };
      setEditableRubric(newRubric);
      const total = Object.values(newRubric).reduce((a, b) => a + b, 0);
      setCalculatedTotal(total);
      setIsScoreChanged(true);
  };

  async function saveUpdatedScore() {
    setIsSaving(true);
    const fullJson = { ...selectedSubmission.analysis_json, rubric: editableRubric };
    try {
        const response = await fetch(`${API_URL}/update-score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submission_id: selectedSubmission.id, new_rubric: fullJson, new_total: calculatedTotal })
        });
        if (response.ok) {
            const updated = submissions.map(sub => sub.id === selectedSubmission.id ? { ...sub, score_total: calculatedTotal, analysis_json: fullJson } : sub);
            setSubmissions(updated);
            setSelectedSubmission({ ...selectedSubmission, score_total: calculatedTotal, analysis_json: fullJson });
            alert("✅ Kaydedildi!");
            setIsScoreChanged(false);
        } else alert("❌ Hata oluştu.");
    } catch (error) { alert("❌ Sunucu hatası."); }
    setIsSaving(false);
  }

  // --- FLASH & SCROLL LOGIC (GÜVENLİ) ---
  const handleErrorClick = (err) => {
      setActiveError(err);
      // GÜVENLİK: Integer kontrolü yap
      if (Number.isInteger(err?.span?.start) && Number.isInteger(err?.span?.end)) {
          const el = document.getElementById(`err-span-${err.span.start}-${err.span.end}`);
          if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              // Kart altında kalmasın diye ufak yukarı it
              setTimeout(() => {
                 window.scrollBy({ top: -80, left: 0, behavior: 'smooth' });
              }, 250);

              // Animasyon Temizliği (Reflow)
              el.classList.remove('flash-active');
              void el.offsetWidth; 
              el.classList.add('flash-active');
              
              // DOM temizliği
              const onAnimEnd = () => {
                  el.classList.remove('flash-active');
                  el.removeEventListener('animationend', onAnimEnd);
              };
              el.addEventListener('animationend', onAnimEnd);
          }
      }
  };

  async function fetchClassrooms() { const { data } = await supabase.from('classrooms').select('*').eq('teacher_email', session.user.email); setClassrooms(data || []); }
  async function createClassroom() { if (!newClassName) return alert("İsim girin"); const newCode = generateClassCode(); const { error } = await supabase.from('classrooms').insert([{ name: newClassName, code: newCode, teacher_email: session.user.email }]); if (!error) { alert(`Sınıf: ${newCode}`); setNewClassName(""); setShowCreateClass(false); fetchClassrooms(); } }
  async function updateClassroom() { if (!editClassName) return; const { error } = await supabase.from('classrooms').update({ name: editClassName }).eq('code', selectedClassCode); if (!error) { alert("Güncellendi"); setIsEditingClass(false); fetchClassrooms(); } }
  async function deleteClassroom() { if (selectedClassCode === "ALL" || !window.confirm("Silinsin mi?")) return; await supabase.from('classrooms').delete().eq('code', selectedClassCode); setSelectedClassCode("ALL"); fetchClassrooms(); fetchSubmissions(); }
  async function deleteSubmission(id) { if(window.confirm("Silinsin mi?")) { await supabase.from('submissions').delete().eq('id', id); setSubmissions(submissions.filter(s => s.id !== id)); if(selectedSubmission?.id === id) setSelectedSubmission(null); } }
  async function fetchSubmissions() { const { data } = await supabase.from('submissions').select('*').order('created_at', { ascending: false }); setSubmissions(data || []); }
  const handleLogout = async () => { await supabase.auth.signOut(); setSubmissions([]); setClassrooms([]); };
  const handleLogin = async (e) => { e.preventDefault(); setLoading(true); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); setLoading(false); };
  async function saveTeacherNote() { setIsSaving(true); await supabase.from('submissions').update({ human_note: teacherNote }).eq('id', selectedSubmission.id); const updated = submissions.map(sub => sub.id === selectedSubmission.id ? { ...sub, human_note: teacherNote } : sub); setSubmissions(updated); setSelectedSubmission({ ...selectedSubmission, human_note: teacherNote }); alert("✅ Not kaydedildi!"); setIsSaving(false); }
  
  const downloadPDF = async () => {
    const source = document.getElementById("report-content");
    if (!source) return;
    const opt = { margin: 10, filename: `Rapor.pdf`, image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } };
    html2pdf().set(opt).from(source).save();
  };

  function calculateStats(data) { 
    let stats = { 'Dilbilgisi': 0, 'Söz Dizimi': 0, 'Yazım/Nokt.': 0, 'Kelime': 0 }; let countries = {}; 
    data.forEach(sub => { 
      if (sub.analysis_json?.errors) sub.analysis_json.errors.forEach(err => { const t = ((err.type||"")+" "+(err.explanation||"")).toLowerCase(); if (t.includes('söz')||t.includes('cümle')) stats['Söz Dizimi']++; else if (t.includes('yazım')||t.includes('nokta')) stats['Yazım/Nokt.']++; else if (t.includes('keli')) stats['Kelime']++; else stats['Dilbilgisi']++; }); 
      const c = sub.country || 'Belirsiz'; countries[c] = (countries[c] || 0) + 1; 
    }); 
    setChartData(Object.keys(stats).map(key => ({ name: key, HataSayisi: stats[key] }))); 
    setCountryData(Object.keys(countries).map(key => ({ name: key, value: countries[key] }))); 
  }

  if (!session) return ( <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', backgroundColor:'#f0f2f5', fontFamily: "'Segoe UI', sans-serif" }}> <div style={{ backgroundColor:'white', padding:40, borderRadius:15, boxShadow:'0 10px 25px rgba(0,0,0,0.05)', width:350, textAlign:'center' }}> <div style={{backgroundColor:'#e8f0fe', width:60, height:60, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px'}}><Lock size={30} color="#3498db"/></div> <h2 style={{color:'#2c3e50', marginBottom:10}}>Öğretmen Girişi</h2> <form onSubmit={handleLogin}> <input type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} style={{width:'100%', padding:12, marginBottom:15, borderRadius:8, border:'1px solid #ddd'}} required /> <input type="password" placeholder="Şifre" value={password} onChange={(e) => setPassword(e.target.value)} style={{width:'100%', padding:12, marginBottom:25, borderRadius:8, border:'1px solid #ddd'}} required /> <button type="submit" disabled={loading} style={{width:'100%', padding:12, backgroundColor:'#3498db', color:'white', border:'none', borderRadius:8, fontWeight:'bold', cursor:'pointer'}}>{loading ? '...' : 'Giriş Yap'}</button> </form> </div> </div> );

  // GLOBAL CSS ENJEKSİYONU
  return (
    <div style={{ padding: '30px', fontFamily: "'Segoe UI', sans-serif", backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
      <style>{GLOBAL_STYLES}</style>
      
      {showImageModal && <ImageViewerModal src={selectedSubmission?.image_url} onClose={() => setShowImageModal(false)} />}
      
      {!selectedSubmission ? (
        <>
            <div style={{marginBottom: 25, display:'flex', justifyContent:'space-between'}}><div><h1 style={{ color: '#2c3e50', margin: 0 }}>🎓 Paneli</h1><p style={{ margin:0, color:'#7f8c8d' }}>{session.user.email}</p></div><button onClick={handleLogout} style={{background:'#e74c3c', color:'white', border:'none', padding:'8px 15px', borderRadius:8, cursor:'pointer'}}>Çıkış</button></div>
            <div style={{backgroundColor:'white', padding:15, borderRadius:12, marginBottom:25, display:'flex', gap:15}}>
                <select value={selectedClassCode} onChange={(e) => setSelectedClassCode(e.target.value)} style={{padding:8, borderRadius:6, border:'1px solid #ddd'}}><option value="ALL">Tüm Sınıflar</option>{classrooms.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}</select>
                <button onClick={() => setShowCreateClass(!showCreateClass)} style={{background:'#2ecc71', color:'white', border:'none', padding:'8px 15px', borderRadius:6, cursor:'pointer'}}>+ Sınıf</button>
                {showCreateClass && <><input value={newClassName} onChange={e=>setNewClassName(e.target.value)} placeholder="İsim" style={{padding:6}} /><button onClick={createClassroom} style={{background:'#3498db', color:'white', border:'none', padding:'6px'}}>Kaydet</button></>}
            </div>
            <div style={{backgroundColor:'white', borderRadius:12, overflow:'hidden'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
                <thead><tr style={{background:'#fafafa', textAlign:'left'}}><th style={{padding:15}}>Tarih</th><th style={{padding:15}}>Öğrenci</th><th style={{padding:15}}>Puan</th><th style={{padding:15}}>İşlem</th><th style={{padding:15}}>Sil</th></tr></thead>
                <tbody>
                {filteredSubmissions.map(sub => (
                    <tr key={sub.id} style={{borderBottom:'1px solid #eee'}}>
                    <td style={{padding:15}}>{new Date(sub.created_at).toLocaleDateString()}</td>
                    <td style={{padding:15}}>{sub.student_name} {sub.student_surname}</td>
                    <td style={{padding:15}}><span style={{background: sub.score_total >= 70 ? '#e8f8f5':'#fdedec', color: sub.score_total >= 70 ? '#27ae60':'#c0392b', padding:'4px 10px', borderRadius:15, fontWeight:'bold'}}>{sub.score_total}</span></td>
                    <td style={{padding:15}}><button onClick={() => setSelectedSubmission(sub)} style={{background:'#34495e', color:'white', border:'none', padding:'6px 15px', borderRadius:6, cursor:'pointer'}}>İncele</button></td>
                    <td style={{padding:15}}><button onClick={()=>deleteSubmission(sub.id)} style={{background:'none', border:'none', cursor:'pointer'}}>🗑️</button></td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>
        </>
      ) : (
        <>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 20 }}>
                <button onClick={() => setSelectedSubmission(null)} style={{ border:'none', background:'none', color:'#3498db', fontWeight:'bold', cursor:'pointer' }}>← Geri Dön</button>
                <button onClick={downloadPDF} style={{ backgroundColor:'#2c3e50', color:'white', padding:'8px 20px', borderRadius:8, border:'none', cursor:'pointer' }}>PDF İndir</button>
            </div>
            <div id="report-content" style={{ display: 'flex', gap: 25, flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ flex: 1, display:'flex', flexDirection:'column', gap:20 }}>
                    <div style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
                        <h3>📄 Orijinal Kağıt</h3>
                        <img src={selectedSubmission.image_url} onClick={() => setShowImageModal(true)} style={{width:'100%', cursor:'zoom-in', border:'1px solid #eee', borderRadius:8}} />
                    </div>
                    <div style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', textAlign:'center' }}>
                        <div style={{fontSize:12, color:'#95a5a6', fontWeight:'bold'}}>PUAN</div>
                        <div style={{fontSize:64, fontWeight:'800', color: calculatedTotal >= 70 ? '#27ae60':'#e74c3c'}}>{calculatedTotal}</div>
                        {isScoreChanged && <button onClick={saveUpdatedScore} style={{background:'#e67e22', color:'white', border:'none', padding:'8px 20px', borderRadius:20, cursor:'pointer', marginBottom:15}}>Kaydet</button>}
                        <ScoreEditor rubric={editableRubric} onUpdate={handleRubricUpdate} />
                    </div>
                </div>
                <div style={{ flex: 1.2 }}>
                    <div style={{ backgroundColor: 'white', padding: 30, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', minHeight:600 }}>
                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:20}}><h3>📝 Analiz</h3><span style={{background:'#f1f2f6', padding:'4px 8px', borderRadius:4, fontSize:12}}>OCR</span></div>
                        <div style={{ lineHeight:1.8, fontSize:16, color:'#2d3436' }}>
                            <HighlightedText 
                                text={selectedSubmission.ocr_text} 
                                errors={selectedSubmission.analysis_json?.errors} 
                                onErrorClick={handleErrorClick} 
                            />
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', marginTop:20 }}>
                        <h4>Öğretmen Notu</h4>
                        <textarea value={teacherNote} onChange={(e) => setTeacherNote(e.target.value)} style={{width:'100%', height:100, padding:10, borderRadius:8, border:'1px solid #ddd'}} />
                        <button onClick={saveTeacherNote} disabled={isSaving} style={{marginTop:10, background:'#3498db', color:'white', border:'none', padding:'8px 20px', borderRadius:6, cursor:'pointer'}}>Kaydet</button>
                    </div>
                </div>
            </div>
            {activeError && <ErrorInspector error={activeError} onClose={() => setActiveError(null)} />}
        </>
      )}
    </div>
  );
}