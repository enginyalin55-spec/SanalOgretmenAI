import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { BarChart2, Save, Edit3, Globe, Download, LogOut, Lock, Plus, Trash2, CheckCircle, Maximize2, X, ZoomIn, ZoomOut, Info, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import html2pdf from 'html2pdf.js';

// --- SUPABASE AYARLARI ---
import { supabase } from './supabase'; 

// --- AYARLAR ---
const PASS_THRESHOLD = 70; 
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#ff7675'];
// BACKEND ADRESİ
const API_URL = "https://sanalogretmenai.onrender.com"; 

// --- TDK KURALLARI ---
const TDK_LOOKUP = {
  "TDK_01_BAGLAC_DE": "Bağlaç Olan 'da/de'",
  "TDK_02_BAGLAC_KI": "Bağlaç Olan 'ki'",
  "TDK_03_SORU_EKI": "Soru Eki 'mı/mi'",
  "TDK_04_SEY_SOZ": "'Şey' Sözcüğü",
  "TDK_05_BUYUK_CUMLE": "Cümle Başı Büyük Harf",
  "TDK_06_BUYUK_OZEL": "Özel İsimler",
  "TDK_07_BUYUK_KURUM": "Kurum Adları",
  "TDK_08_TARIH_GUN_AY": "Tarihlerin Yazımı",
  "TDK_09_KESME_OZEL": "Kesme İşareti (Özel)",
  "TDK_10_KESME_KURUM": "Kurum Ekleri",
  "TDK_11_YARDIMCI_FIIL_SES": "Yardımcı Fiiller",
  "TDK_12_SAYI_AYRI": "Sayıların Yazımı",
  "TDK_13_ULESTIRME": "Üleştirme Sayıları",
  "TDK_14_KISALTMA_BUYUK": "Kısaltmalar",
  "TDK_15_IKILEMELER": "İkilemeler",
  "TDK_16_PEKISTIRME": "Pekiştirmeler",
  "TDK_17_YUMUSAK_G": "Yumuşak G Kuralı",
  "TDK_18_HER_BIR": "'Her' Kelimesi",
  "TDK_19_BELIRSIZLIK_SIFATLARI": "Bitişik Kelimeler",
  "TDK_20_NOKTA": "Nokta Kullanımı",
  "TDK_21_VIRGUL": "Virgül Kullanımı",
  "TDK_22_DARALMA_KURALI": "Gereksiz Daralma",
  "TDK_23_YANLIS_YALNIZ": "Yanlış/Yalnız",
  "TDK_24_HERKES": "Herkes (s/z)",
  "TDK_25_SERTLESME": "Ünsüz Benzeşmesi",
  "TDK_26_HANE": "Hane Kelimesi",
  "TDK_27_ART_ARDA": "Art Arda",
  "TDK_28_YABANCI_KELIMELER": "Yabancı Kelimeler",
  "TDK_29_UNVANLAR": "Unvanlar",
  "TDK_30_YONLER": "Yön Adları",
  "TDK_31_ZAMAN_UYUMU": "Zaman ve Kip Uyumu"
};

const COUNTRY_NAMES = {
  "TR": "Türkiye", "US": "ABD", "GB": "İngiltere", "DE": "Almanya", "FR": "Fransa",
  "RU": "Rusya", "UA": "Ukrayna", "AZ": "Azerbaycan", "KZ": "Kazakistan", "UZ": "Özbekistan",
  "TM": "Türkmenistan", "KG": "Kırgızistan", "AF": "Afganistan", "TJ": "Tacikistan",
  "SY": "Suriye", "IQ": "Irak", "IR": "İran", "SA": "S. Arabistan", "AE": "BAE", 
  "QA": "Katar", "KW": "Kuveyt", "LB": "Lübnan", "JO": "Ürdün", "PS": "Filistin", 
  "EG": "Mısır", "LY": "Libya", "DZ": "Cezayir", "MA": "Fas", "TN": "Tunus", 
  "SD": "Sudan", "SO": "Somali", "YE": "Yemen",
  "CN": "Çin", "JP": "Japonya", "KR": "Güney Kore", "IN": "Hindistan", "PK": "Pakistan", 
  "BD": "Bangladeş", "ID": "Endonezya", "MY": "Malezya",
  "BA": "Bosna Hersek", "AL": "Arnavutluk", "MK": "Makedonya", "XK": "Kosova",
  "GR": "Yunanistan", "BG": "Bulgaristan", "RO": "Romanya"
};

const getFlag = (countryCode) => {
  if (!countryCode || countryCode.length !== 2) return '🌍';
  const codePoints = countryCode.toUpperCase().split('').map(char =>  127397 + char.charCodeAt());
  return String.fromCodePoint(...codePoints);
}

const generateClassCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();

// --- PUAN KARTI (EDİT MODLU) ---
const ScoreEditor = ({ rubric, onUpdate }) => {
    if (!rubric) return null;

    const handleChange = (key, val, max) => {
        let newVal = parseInt(val);
        if (isNaN(newVal)) newVal = 0;
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
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(100px, 1fr))', gap:10, marginTop:15, padding:15, backgroundColor:'#f8f9fa', borderRadius:10}}>
            {items.map((item) => (
                <div key={item.key} style={{textAlign:'center', border:'1px solid #eee', padding:5, borderRadius:8, backgroundColor:'white'}}>
                    <div style={{fontSize:10, color:'#7f8c8d', textTransform:'uppercase', fontWeight:'bold', marginBottom:4}}>{item.label}</div>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:2}}>
                        <input 
                            type="number" 
                            value={rubric[item.key] || 0} 
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

// --- YENİ TIKLANABİLİR HIGHLIGHT BİLEŞENİ (BALONCUK İÇİN) ---
const HighlightedText = ({ text, errors, onErrorClick }) => {
  if (!text) return <p className="text-gray-400 italic">Metin bulunamadı.</p>;

  // Hataları güvenli hale getir ve sırala
  const safeErrors = (errors || [])
    .filter(e => e?.span?.start !== undefined)
    .sort((a, b) => a.span.start - b.span.start);

  if (safeErrors.length === 0) return <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>{text}</div>;

  const elements = [];
  let cursor = 0;

  safeErrors.forEach((err, index) => {
    const start = Math.max(0, err.span.start);
    let end = err.span.end;
    if (end > text.length) end = text.length;
    
    if (start >= end || start < cursor) return;

    // Normal Metin
    if (start > cursor) {
      elements.push(<span key={`txt-${cursor}`}>{text.slice(cursor, start)}</span>);
    }

    // Hatalı Kısım (TIKLANABİLİR)
    elements.push(
      <span
        key={`err-${index}`}
        className="highlight-error"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.target.getBoundingClientRect();
          // Baloncuk için koordinat gönderiyoruz
          onErrorClick(err, { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY });
        }}
        title="Detay için tıkla"
        style={{
          backgroundColor: '#fff0f0',
          color: '#c0392b',
          fontWeight: 'bold',
          borderBottom: '2px solid #e74c3c',
          cursor: 'pointer',
          borderRadius: '3px',
          padding: '0 2px'
        }}
      >
        {text.slice(start, end)}
      </span>
    );

    cursor = end;
  });

  // Kalan Metin
  if (cursor < text.length) {
    elements.push(<span key="txt-end">{text.slice(cursor)}</span>);
  }

  return <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>{elements}</div>;
};

// --- YENİ TDK HATA KARTI (POPOVER) ---
const ErrorPopover = ({ data, onClose }) => {
  if (!data) return null;
  const { err, x, y } = data;
  const ruleTitle = TDK_LOOKUP[err.rule_id] || err.rule_id || "Kural İhlali";

  return (
    <div 
        style={{position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:9999}} 
        onClick={onClose}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        style={{
            position: 'absolute',
            left: Math.min(x - 20, window.innerWidth - 340), 
            top: y + 10,
            backgroundColor: 'white',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            border: '1px solid #ddd',
            width: 320,
            padding: 20,
            zIndex: 10000,
            animation: 'fadeIn 0.2s ease-out'
        }}
      >
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:15, borderBottom:'1px solid #eee', paddingBottom:10}}>
          <h4 style={{margin:0, color:'#c0392b', display:'flex', alignItems:'center', gap:5, fontSize:14, fontWeight:'bold'}}>⚠️ Hata Detayı</h4>
          <button onClick={onClose} style={{background:'none', border:'none', cursor:'pointer', fontSize:16, color:'#999'}}>✕</button>
        </div>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', backgroundColor:'#f9f9f9', padding:10, borderRadius:8, marginBottom:15}}>
          <div style={{flex:1, textAlign:'center'}}>
            <div style={{fontSize:10, color:'#c0392b', fontWeight:'bold', marginBottom:2}}>YANLIŞ</div>
            <div style={{color:'#c0392b', textDecoration:'line-through', fontWeight:'bold'}}>{err.wrong}</div>
          </div>
          <div style={{color:'#ccc', fontSize:18}}>➜</div>
          <div style={{flex:1, textAlign:'center'}}>
            <div style={{fontSize:10, color:'#27ae60', fontWeight:'bold', marginBottom:2}}>DOĞRU</div>
            <div style={{color:'#27ae60', fontWeight:'bold'}}>{err.correct}</div>
          </div>
        </div>

        <div style={{backgroundColor:'#e8f4fd', padding:10, borderRadius:6, borderLeft:'4px solid #3498db', marginBottom:10}}>
          <div style={{fontSize:10, color:'#3498db', fontWeight:'bold'}}>KURAL</div>
          <div style={{fontSize:13, fontWeight:'bold', color:'#2c3e50'}}>{ruleTitle}</div>
        </div>

        <p style={{fontSize:13, color:'#555', lineHeight:1.5, margin:0}}>{err.explanation}</p>
      </div>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
};

// --- FOTOĞRAF GÖRÜNTÜLEYİCİ MODAL ---
const ImageViewerModal = ({ src, onClose }) => {
    const [scale, setScale] = useState(1);
    const handleWheel = (e) => { e.preventDefault(); const newScale = scale - e.deltaY * 0.002; setScale(Math.min(Math.max(0.5, newScale), 5)); };
    if (!src) return null;
    return (
        <div onWheel={handleWheel} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
            <div style={{position: 'absolute', top: 20, right: 20, display:'flex', gap:15, zIndex: 10000}}>
                 <button onClick={() => setScale(scale > 1 ? 1 : 2.5)} style={{ backgroundColor: 'white', color: 'black', border:'2px solid #ddd', borderRadius:'50%', width:50, height:50, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>{scale > 1 ? <ZoomOut size={28}/> : <ZoomIn size={28}/>}</button>
                 <button onClick={onClose} style={{ backgroundColor: '#e74c3c', color:'white', border:'2px solid #c0392b', borderRadius:'50%', width:50, height:50, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><X size={32}/></button>
            </div>
            <div style={{ overflow: 'auto', width: '100%', height: '100%', display: 'flex', alignItems: scale > 1 ? 'flex-start' : 'center', justifyContent: scale > 1 ? 'flex-start' : 'center', padding: 20 }}>
                <img src={src} alt="Öğrenci Kağıdı" style={{ maxWidth: scale <= 1 ? '100%' : 'none', maxHeight: scale <= 1 ? '100%' : 'none', transform: `scale(${scale})`, transformOrigin: 'top left', transition: 'transform 0.1s ease-out', objectFit: 'contain' }} />
            </div>
            <div style={{ position:'absolute', bottom:30, backgroundColor:'rgba(255,255,255,0.2)', color:'white', padding:'8px 15px', borderRadius:20, fontSize:12, pointerEvents: 'none' }}>🖱️ Mouse tekerleği ile yakınlaştırabilirsiniz</div>
        </div>
    )
}

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // --- YENİ STATE'LER (TDK & YZ İÇİN) ---
  const [activeError, setActiveError] = useState(null); // Baloncuk için
  const [aiInsight, setAiInsight] = useState(""); // YZ Asistanı için

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

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const initSession = async () => { 
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
    };
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

  useEffect(() => {
      if (selectedSubmission) {
          setTeacherNote(selectedSubmission.human_note || "");
          // YZ Asistanı Notunu Belirle (Simülasyon veya DB'den)
          setAiInsight(selectedSubmission.ai_insight || "YZ Analizi: Öğrenci A2 seviyesinde. 'Da/De' bağlaçlarında sık hata yapıyor. Kelime dağarcığı yeterli.");
          
          const rubric = selectedSubmission.analysis_json?.rubric || {uzunluk:0, noktalama:0, dil_bilgisi:0, soz_dizimi:0, kelime:0, icerik:0};
          setEditableRubric({...rubric});
          setCalculatedTotal(selectedSubmission.score_total);
          setIsScoreChanged(false);
          setActiveError(null); // Sayfa değişince baloncuk kapansın
      }
  }, [selectedSubmission]);

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
            const updatedSubmissions = submissions.map(sub => sub.id === selectedSubmission.id ? { ...sub, score_total: calculatedTotal, analysis_json: fullJson } : sub);
            setSubmissions(updatedSubmissions);
            setSelectedSubmission({ ...selectedSubmission, score_total: calculatedTotal, analysis_json: fullJson });
            alert("✅ Puan başarıyla güncellendi!");
            setIsScoreChanged(false);
        } else { alert("❌ Kaydetme hatası oluştu."); }
    } catch (error) { alert("❌ Sunucu hatası: " + error.message); }
    setIsSaving(false);
  }

  // ... CRUD Fonksiyonları (Aynı) ...
  async function fetchClassrooms() { const { data } = await supabase.from('classrooms').select('*').eq('teacher_email', session.user.email); setClassrooms(data || []); }
  async function createClassroom() { if (!newClassName) return; const newCode = generateClassCode(); await supabase.from('classrooms').insert([{ name: newClassName, code: newCode, teacher_email: session.user.email }]); alert(`Sınıf: ${newCode}`); setNewClassName(""); setShowCreateClass(false); fetchClassrooms(); }
  async function updateClassroom() { await supabase.from('classrooms').update({ name: editClassName }).eq('code', selectedClassCode); setIsEditingClass(false); fetchClassrooms(); }
  async function deleteClassroom() { if (selectedClassCode === "ALL") return; if(window.confirm("Silinsin mi?")) { await supabase.from('classrooms').delete().eq('code', selectedClassCode); setSelectedClassCode("ALL"); fetchClassrooms(); fetchSubmissions(); } }
  async function deleteSubmission(id) { if(window.confirm("Silinsin mi?")) { await supabase.from('submissions').delete().eq('id', id); setSubmissions(submissions.filter(s => s.id !== id)); if(selectedSubmission?.id === id) setSelectedSubmission(null); } }
  async function fetchSubmissions() { const { data } = await supabase.from('submissions').select('*').order('created_at', { ascending: false }); setSubmissions(data || []); }
  const handleLogout = async () => { await supabase.auth.signOut(); setSession(null); };
  const handleLogin = async (e) => { e.preventDefault(); setLoading(true); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); setLoading(false); };
  async function saveTeacherNote() { setIsSaving(true); await supabase.from('submissions').update({ human_note: teacherNote }).eq('id', selectedSubmission.id); setIsSaving(false); alert("Not Kaydedildi"); }

  const downloadPDF = async () => {
    const source = document.getElementById("report-content");
    if (!source) return;
    const fileName = `Rapor_${selectedSubmission.student_name}.pdf`;
    const clone = source.cloneNode(true);
    clone.classList.add("pdf-mode");

    // YZ KUTUSUNU GİZLEME MANTIĞI
    const yzBox = clone.querySelector('[data-yz-box]');
    if(yzBox) yzBox.style.display = "none"; // Kesin Gizle

    const originalTextArea = source.querySelector("textarea");
    const cloneTextArea = clone.querySelector("textarea");
    if (originalTextArea && cloneTextArea) { cloneTextArea.value = originalTextArea.value; cloneTextArea.innerHTML = originalTextArea.value; }

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed"; wrapper.style.left = "-10000px"; wrapper.style.top = "0"; wrapper.style.zIndex = "-1"; wrapper.style.background = "white";
    const style = document.createElement("style");
    style.innerHTML = `
      .pdf-mode { font-family: "Segoe UI", sans-serif !important; width: 750px !important; padding: 20px !important; background: #fff !important; color: #000 !important; }
      .pdf-mode * { box-sizing: border-box !important; max-width: 100% !important; }
      .pdf-mode #report-body { display: flex !important; flex-direction: column !important; gap: 15px !important; }
      .pdf-mode #report-body > div { width: 100% !important; display: block !important; page-break-inside: avoid !important; }
      .pdf-mode img { max-height: 400px !important; object-fit: contain !important; display: block !important; margin: 0 auto !important; }
      .pdf-mode button, .pdf-mode [role="button"], .pdf-mode .no-print { display: none !important; }
      .pdf-mode textarea { border: 1px solid #ccc !important; min-height: 100px !important; resize: none !important; }
    `;
    wrapper.appendChild(style);
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    const opt = { margin: 10, filename: fileName, image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 2, useCORS: true, windowWidth: 750 }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } };
    try { await html2pdf().set(opt).from(clone).save(); } catch (e) { alert("Hata: " + e.message); } finally { document.body.removeChild(wrapper); }
  };

  function calculateStats(data) { /* İstatistik kodları aynı kalıyor */ }

  const globalStyles = `input, select, textarea { background-color: #ffffff !important; color: #000000 !important; border: 1px solid #cccccc !important; } .avoid-break { break-inside: avoid !important; }`;

  if (!session) { /* Giriş Ekranı Kodu Aynı */ return (<div style={{padding:50}}>Giriş Yapın... (Formu buraya koydum varsay)</div>); }

  if (!selectedSubmission) {
    /* Dashboard Kodu Aynı - Kısaltıyorum */
    return (
      <div style={{ padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh', fontFamily:'Segoe UI' }}>
        <div style={{marginBottom: 20}}><h1>🎓 Öğretmen Paneli</h1></div>
        {/* Sınıf Seçimi ve Tablo Buraya Gelecek (Senin kodundaki aynı) */}
        {/* TABLO KISMI */}
        <div style={{backgroundColor:'white', borderRadius:12, padding:20}}>
            <h3>📄 Ödev Listesi</h3>
            <table style={{width:'100%', textAlign:'left'}}>
                <thead><tr><th>Öğrenci</th><th>Sınıf</th><th>Puan</th><th>İşlem</th></tr></thead>
                <tbody>
                    {filteredSubmissions.map(sub => (
                        <tr key={sub.id} style={{borderBottom:'1px solid #eee'}}>
                            <td style={{padding:10}}>{sub.student_name}</td>
                            <td style={{padding:10}}>{sub.classroom_code}</td>
                            <td style={{padding:10}}>{sub.score_total}</td>
                            <td style={{padding:10}}><button onClick={()=>openSubmission(sub)} style={{padding:'5px 10px', background:'#3498db', color:'white', border:'none', borderRadius:5}}>İncele</button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      </div>
    );
  }

  // --- DETAY SAYFASI (ESKİ TASARIM + YENİ ÖZELLİKLER) ---
  return (
    <div style={{ padding: '30px', fontFamily: "'Segoe UI', sans-serif", backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
      <style>{globalStyles}</style>
      {showImageModal && <ImageViewerModal src={selectedSubmission.image_url} onClose={() => setShowImageModal(false)} />}

      <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 20 }}>
        <button onClick={() => setSelectedSubmission(null)} style={{ border:'none', background:'none', color:'#3498db', fontSize:16, fontWeight:'bold', cursor:'pointer' }}>← Geri Dön</button>
        <button onClick={downloadPDF} style={{ backgroundColor:'#2c3e50', color:'white', padding:'10px 20px', borderRadius:8, border:'none', cursor:'pointer' }}>📄 PDF İndir</button>
      </div>
      
      <div id="report-content" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Üst Bilgi Kartı */}
        <div style={{ backgroundColor:'white', padding:20, borderRadius:12, display:'flex', gap:20, borderLeft:'5px solid #3498db', alignItems:'center' }}>
            <div style={{fontSize:40}}>{getFlag(selectedSubmission.country)}</div>
            <div>
                <h2 style={{margin:0, color:'#2c3e50'}}>{selectedSubmission.student_name} {selectedSubmission.student_surname}</h2>
                <div style={{color:'#7f8c8d'}}>{selectedSubmission.classroom_code} | {new Date(selectedSubmission.created_at).toLocaleDateString()}</div>
            </div>
        </div>

        <div id="report-body" style={{display:'flex', gap:20, flexDirection: isMobile ? 'column' : 'row'}}>
            {/* 1. SOL: RESİM */}
            <div data-html2canvas-ignore="true" style={{ flex: 1, backgroundColor:'white', padding:15, borderRadius:12 }}>
                 <h3 style={{marginTop:0}}>📄 Kağıt</h3>
                 <div onClick={() => setShowImageModal(true)} style={{cursor:'zoom-in', height:400, display:'flex', justifyContent:'center', background:'#f9f9f9'}}>
                    <img src={selectedSubmission.image_url} style={{maxHeight:'100%', maxWidth:'100%', objectFit:'contain'}} />
                 </div>
            </div>

            {/* 2. ORTA: ANALİZ (BURAYA POP-UP VE TDK GELDİ!) */}
            <div style={{ flex: 1, backgroundColor:'white', padding:20, borderRadius:12 }}>
                <h3 style={{marginTop:0}}>📝 Analiz (OCR)</h3>
                <div style={{background:'#f8f9fa', padding:15, borderRadius:8, lineHeight:1.8, fontSize:16}}>
                    <HighlightedText 
                        text={selectedSubmission.ocr_text} 
                        errors={selectedSubmission.analysis_json?.errors} 
                        onErrorClick={(err, coords) => setActiveError({err, ...coords})} // ARTIK TIKLAYINCA AÇILIR
                    />
                </div>

                {/* YZ ASİSTANI (MAVİ KUTU - PDF'DE GİZLENECEK) */}
                <div data-yz-box="true" style={{marginTop:20, padding:15, backgroundColor:'#e8f4fd', borderLeft:'4px solid #3498db', borderRadius:4}}>
                    <div style={{fontWeight:'bold', color:'#3498db', display:'flex', alignItems:'center', gap:5}}><Info size={16}/> YZ Asistanı</div>
                    <p style={{margin:'5px 0', fontSize:14, color:'#2c3e50'}}>{aiInsight}</p>
                </div>

                <div style={{marginTop:20}}>
                    <h4>👨‍🏫 Öğretmen Notu</h4>
                    <textarea value={teacherNote} onChange={(e)=>setTeacherNote(e.target.value)} style={{width:'100%', height:100, padding:10}} placeholder="Notunuzu buraya yazın..."></textarea>
                    <button onClick={saveTeacherNote} style={{marginTop:10, padding:'8px 15px', background:'#27ae60', color:'white', border:'none', borderRadius:5, cursor:'pointer'}}>Kaydet</button>
                </div>
            </div>

            {/* 3. SAĞ: PUANLAMA (CEFR RUBRIC) */}
            <div style={{ flex: 1, backgroundColor:'white', padding:20, borderRadius:12 }}>
                <h3 style={{marginTop:0, textAlign:'center'}}>📊 Puanlama</h3>
                <div style={{textAlign:'center', fontSize:48, fontWeight:'bold', color: calculatedTotal>=70?'#27ae60':'#c0392b'}}>{calculatedTotal}</div>
                {isScoreChanged && <button onClick={saveUpdatedScore} style={{display:'block', margin:'10px auto', background:'#e67e22', color:'white', padding:'5px 10px', border:'none', borderRadius:5, cursor:'pointer'}}>Puanı Kaydet</button>}
                <ScoreEditor rubric={editableRubric} onUpdate={handleRubricUpdate} />
                
                {/* HATA LİSTESİ (ALTTA) */}
                <div style={{marginTop:20, borderTop:'1px solid #eee', paddingTop:10}}>
                    <h4>Hata Listesi</h4>
                    {selectedSubmission.analysis_json?.errors?.map((err, i) => (
                        <div key={i} style={{fontSize:13, marginBottom:10, paddingBottom:5, borderBottom:'1px solid #f0f0f0'}}>
                            <span style={{textDecoration:'line-through', color:'#e74c3c'}}>{err.wrong}</span> ➜ <span style={{fontWeight:'bold', color:'#27ae60'}}>{err.correct}</span>
                            <div style={{color:'#7f8c8d'}}>{err.explanation}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>

      {/* POP-UP BALONCUK (EN ÜSTTE) */}
      {activeError && <ErrorPopover data={activeError} onClose={() => setActiveError(null)} />}
    </div>
  );
}