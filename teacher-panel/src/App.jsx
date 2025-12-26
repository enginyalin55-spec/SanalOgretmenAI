import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { BarChart2, Save, Edit3, Globe, Download, LogOut, Lock, Plus, Trash2, CheckCircle, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import html2pdf from 'html2pdf.js';

// --- AYARLAR ---
const PASS_THRESHOLD = 70; 
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#ff7675'];
// BACKEND ADRESİ
const API_URL = "https://sanalogretmenai.onrender.com"; 

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

// --- ZIRHLI BOYAMA BİLEŞENİ ---
const HighlightedText = ({ text, errors }) => {
  if (!text) return null;
  if (!errors || !Array.isArray(errors) || errors.length === 0) return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;

  const ranges = [];
  const lowerText = text.toLocaleLowerCase('tr');

  errors.forEach(err => {
    if (!err.wrong) return;
    const searchStr = err.wrong.trim().toLocaleLowerCase('tr');
    if (searchStr.length < 2) return;

    let pos = lowerText.indexOf(searchStr);
    
    if (pos === -1) {
       try {
         const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
         const pattern = escaped.replace(/\s+/g, '[\\s\\n\\r]+');
         const regex = new RegExp(pattern, 'g'); 
         
         let match;
         while ((match = regex.exec(lowerText)) !== null) {
           ranges.push({
             start: match.index,
             end: match.index + match[0].length,
             error: err
           });
         }
       } catch (e) {}
    } else {
       while (pos !== -1) {
         ranges.push({ start: pos, end: pos + searchStr.length, error: err });
         pos = lowerText.indexOf(searchStr, pos + 1);
       }
    }
  });

  ranges.sort((a, b) => a.start - b.start);

  const uniqueRanges = [];
  let lastEnd = 0;
  ranges.forEach(r => {
    if (r.start >= lastEnd) {
      uniqueRanges.push(r);
      lastEnd = r.end;
    }
  });

  const elements = [];
  let currentIndex = 0;

  uniqueRanges.forEach((range, i) => {
    if (range.start > currentIndex) {
      elements.push(<span key={`txt-${i}`}>{text.substring(currentIndex, range.start)}</span>);
    }
    elements.push(
      <span
        key={`err-${i}`}
        title={`❌ Yanlış: ${range.error.wrong}\n✅ Doğrusu: ${range.error.correct}\n💡 Açıklama: ${range.error.explanation}`}
        style={{
          backgroundColor: '#fff0f0',
          color: '#c0392b',
          fontWeight: 'bold',
          borderBottom: '2px solid #e74c3c',
          cursor: 'help',
          borderRadius: '3px'
        }}
      >
        {text.substring(range.start, range.end)}
      </span>
    );
    currentIndex = range.end;
  });

  if (currentIndex < text.length) {
    elements.push(<span key="txt-end">{text.substring(currentIndex)}</span>);
  }

  return <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>{elements}</div>;
};

// --- FOTOĞRAF GÖRÜNTÜLEYİCİ MODAL ---
const ImageViewerModal = ({ src, onClose }) => {
    const [scale, setScale] = useState(1);
    
    const handleWheel = (e) => {
        e.preventDefault();
        const newScale = scale - e.deltaY * 0.002;
        const clampedScale = Math.min(Math.max(0.5, newScale), 5);
        setScale(clampedScale);
    };

    if (!src) return null;

    return (
        <div 
            onWheel={handleWheel} 
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 9999,
                display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column'
            }}
        >
            <div style={{position: 'absolute', top: 20, right: 20, display:'flex', gap:15, zIndex: 10000}}>
                 <button 
                    onClick={() => setScale(scale > 1 ? 1 : 2.5)} 
                    title={scale > 1 ? "Küçült" : "Büyüt"}
                    style={{
                        backgroundColor: 'white', 
                        color: 'black',
                        border:'2px solid #ddd', 
                        borderRadius:'50%', width:50, height:50, 
                        cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                    }}
                 >
                    {scale > 1 ? <ZoomOut size={28} strokeWidth={2.5}/> : <ZoomIn size={28} strokeWidth={2.5}/>}
                 </button>

                 <button 
                    onClick={onClose} 
                    title="Kapat"
                    style={{
                        backgroundColor: '#e74c3c', 
                        color:'white',
                        border:'2px solid #c0392b', 
                        borderRadius:'50%', width:50, height:50, 
                        cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                    }}
                 >
                    <X size={32} strokeWidth={3}/>
                 </button>
            </div>
            
            <div style={{
                overflow: 'auto', 
                width: '100%', 
                height: '100%', 
                display: 'flex', 
                alignItems: scale > 1 ? 'flex-start' : 'center', 
                justifyContent: scale > 1 ? 'flex-start' : 'center',
                padding: 20
            }}>
                <img 
                    src={src} 
                    alt="Öğrenci Kağıdı" 
                    style={{
                        maxWidth: scale <= 1 ? '100%' : 'none', 
                        maxHeight: scale <= 1 ? '100%' : 'none',
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        transition: 'transform 0.1s ease-out', 
                        objectFit: 'contain'
                    }} 
                />
            </div>
            
            <div style={{
                position:'absolute', bottom:30, 
                backgroundColor:'rgba(255,255,255,0.2)', color:'white', 
                padding:'8px 15px', borderRadius:20, fontSize:12,
                pointerEvents: 'none'
            }}>
                🖱️ Mouse tekerleği ile yakınlaştırabilirsiniz
            </div>
        </div>
    )
}

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // --- SINIF YÖNETİMİ ---
  const [classrooms, setClassrooms] = useState([]); 
  const [selectedClassCode, setSelectedClassCode] = useState("ALL"); 
  const [showCreateClass, setShowCreateClass] = useState(false); 
  const [newClassName, setNewClassName] = useState(""); 
  const [isEditingClass, setIsEditingClass] = useState(false);
  const [editClassName, setEditClassName] = useState("");

  // --- İÇERİK ---
  const [submissions, setSubmissions] = useState([]);
  const [filteredSubmissions, setFilteredSubmissions] = useState([]); 
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [showImageModal, setShowImageModal] = useState(false);
  
  // PUAN DÜZENLEME STATE'i
  const [editableRubric, setEditableRubric] = useState(null);
  const [calculatedTotal, setCalculatedTotal] = useState(0);
  const [isScoreChanged, setIsScoreChanged] = useState(false);

  const [chartData, setChartData] = useState([]);
  const [countryData, setCountryData] = useState([]);
  const [teacherNote, setTeacherNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  // EKRAN BOYUTU TAKİBİ (MOBİL/PC)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- OTURUM YÖNETİMİ ---
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

  useEffect(() => {
      if (selectedSubmission) {
          setTeacherNote(selectedSubmission.human_note || "");
          const rubric = selectedSubmission.analysis_json?.rubric || {uzunluk:0, noktalama:0, dil_bilgisi:0, soz_dizimi:0, kelime:0, icerik:0};
          setEditableRubric({...rubric});
          setCalculatedTotal(selectedSubmission.score_total);
          setIsScoreChanged(false);
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
            body: JSON.stringify({
                submission_id: selectedSubmission.id,
                new_rubric: fullJson, 
                new_total: calculatedTotal
            })
        });

        if (response.ok) {
            const updatedSubmissions = submissions.map(sub => 
                sub.id === selectedSubmission.id 
                ? { ...sub, score_total: calculatedTotal, analysis_json: fullJson } 
                : sub
            );
            setSubmissions(updatedSubmissions);
            setSelectedSubmission({ ...selectedSubmission, score_total: calculatedTotal, analysis_json: fullJson });
            alert("✅ Puan başarıyla güncellendi!");
            setIsScoreChanged(false);
        } else {
            alert("❌ Kaydetme hatası oluştu.");
        }
    } catch (error) {
        alert("❌ Sunucu hatası: " + error.message);
    }
    setIsSaving(false);
  }

  async function fetchClassrooms() { const { data, error } = await supabase.from('classrooms').select('*').eq('teacher_email', session.user.email); if (error) console.log("Sınıf hatası:", error); else setClassrooms(data); }
  async function createClassroom() { if (!newClassName) return alert("Lütfen sınıf adı girin!"); const newCode = generateClassCode(); const { error } = await supabase.from('classrooms').insert([{ name: newClassName, code: newCode, teacher_email: session.user.email }]); if (error) alert("Hata: " + error.message); else { alert(`✅ Sınıf Oluşturuldu! Kod: ${newCode}`); setNewClassName(""); setShowCreateClass(false); fetchClassrooms(); } }
  async function updateClassroom() { if (!editClassName) return alert("Sınıf adı boş olamaz."); const { error } = await supabase.from('classrooms').update({ name: editClassName }).eq('code', selectedClassCode); if (error) { alert("Hata: " + error.message); } else { alert("✅ Sınıf adı güncellendi!"); setIsEditingClass(false); fetchClassrooms(); } }
  async function deleteClassroom() { if (selectedClassCode === "ALL") return; const classToDelete = classrooms.find(c => c.code === selectedClassCode); if (!classToDelete) return; if(window.confirm(`⚠️ DİKKAT!\n\n"${classToDelete.name}" sınıfını silmek üzeresiniz.\nBuna bağlı tüm öğrenci ödevleri de silinecek!\n\nEmin misiniz?`)) { const { error } = await supabase.from('classrooms').delete().eq('code', selectedClassCode); if (error) { alert("Hata: " + error.message); } else { alert("🗑️ Sınıf silindi."); setSelectedClassCode("ALL"); fetchClassrooms(); fetchSubmissions(); } } }
  async function deleteSubmission(id, studentName) { if(window.confirm(`${studentName} isimli öğrencinin ödevini silmek istediğinize emin misiniz?`)) { const { error } = await supabase.from('submissions').delete().eq('id', id); if(error) { alert("Hata: " + error.message); } else { const updatedList = submissions.filter(sub => sub.id !== id); setSubmissions(updatedList); if(selectedSubmission && selectedSubmission.id === id) setSelectedSubmission(null); alert("🗑️ Kayıt silindi."); } } }
  async function fetchSubmissions() { const { data, error } = await supabase.from('submissions').select('*').order('created_at', { ascending: false }); if (error) console.log('Hata:', error); else setSubmissions(data); }
  const handleLogout = async () => { await supabase.auth.signOut(); setSubmissions([]); setClassrooms([]); };
  const handleLogin = async (e) => { e.preventDefault(); setLoading(true); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert("Giriş başarısız: " + error.message); setLoading(false); };
  
  async function saveTeacherNote() {
    setIsSaving(true);
    const { error } = await supabase.from('submissions').update({ human_note: teacherNote }).eq('id', selectedSubmission.id);
    if (error) alert("Hata: " + error.message);
    else { const updated = submissions.map(sub => sub.id === selectedSubmission.id ? { ...sub, human_note: teacherNote } : sub); setSubmissions(updated); setSelectedSubmission({ ...selectedSubmission, human_note: teacherNote }); alert("✅ Not kaydedildi!"); }
    setIsSaving(false);
  }

// --- FINAL + DÜZELTİLMİŞ: %100 GARANTİLİ DİKEY RAPOR (OCR VE ÖĞRETMEN NOTU DAHİL) ---
const downloadPDF = async () => {
  const source = document.getElementById("report-content");
  if (!source) return;

  const safeName = (selectedSubmission.student_name || "").trim().replace(/\s+/g, "_");
  const safeSurname = (selectedSubmission.student_surname || "").trim().replace(/\s+/g, "_");
  const fileName = `Rapor_${safeName}_${safeSurname}.pdf`;

  // 1) KLON OLUŞTUR
  const clone = source.cloneNode(true);
  clone.classList.add("pdf-mode");

  // --- KRİTİK DÜZELTME 1: ÖĞRETMEN NOTUNU (TEXTAREA) KURTAR ---
  // Klonlama işlemi textarea içindeki yazıyı almaz. Elle taşıyoruz.
  const originalTextArea = source.querySelector("textarea");
  const cloneTextArea = clone.querySelector("textarea");
  if (originalTextArea && cloneTextArea) {
    cloneTextArea.value = originalTextArea.value;      // Değeri kopyala
    cloneTextArea.innerHTML = originalTextArea.value;  // HTML içeriğini de garantiye al
  }

  // ✅ PDF'de textarea yerine metin bloğu kullan (AI kutusu gibi sığması için)
  if (cloneTextArea) {
    const teacherDiv = document.createElement("div");
    teacherDiv.className = "pdf-teacher-note";
    teacherDiv.textContent = (cloneTextArea.value || "").trim();
    cloneTextArea.parentNode.replaceChild(teacherDiv, cloneTextArea);
  }

  // 2) GİZLİ WRAPPER (Ekran dışı)
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-10000px";
  wrapper.style.top = "0";
  wrapper.style.zIndex = "-1";
  wrapper.style.background = "white";

  // ✅ A4 güvenli alan
  const PDF_WIDTH = 720;

  // 3) PDF İÇİN GARANTİ CSS
  const style = document.createElement("style");
  style.innerHTML = `
    .pdf-mode {
      font-family: "Segoe UI", Arial, sans-serif !important;
      width: ${PDF_WIDTH}px !important;
      padding: 24px !important;
      background-color: #fff !important;
      color: #000 !important;
      box-sizing: border-box !important;
    }
    .pdf-mode, .pdf-mode *{
      box-sizing: border-box !important;
      max-width: 100% !important;
    }

    /* ✅ ÜST BİLGİ ÇERÇEVESİ TAM ÇIKSIN */
    .pdf-mode > div:first-child {
      border: 1px solid #ddd !important;
      border-radius: 14px !important;
      box-shadow: none !important;
      padding: 16px !important;
      margin-bottom: 20px !important;
      background: #fff !important;
    }

    /* ANA GÖVDEYİ DİKEY (ALT ALTA) YAP */
    .pdf-mode #report-body {
      display: flex !important;
      flex-direction: column !important;
      gap: 18px !important;
    }

    /* 1. RESİM ALANI */
    .pdf-mode #report-body > div:nth-child(1) {
      display: block !important;
      width: 100% !important;
      border: 1px solid #ddd !important;
      padding: 10px !important;
      background: #fafafa !important;
    }
    .pdf-mode img {
      width: 100% !important;
      max-height: 520px !important;
      object-fit: contain !important;
      display: block !important;
      margin: 0 auto !important;
    }
    .pdf-mode #report-body > div:nth-child(1) div[style*="absolute"] {
      display: none !important;
    }

    /* --- KRİTİK DÜZELTME 2: ORTA SÜTUNU (OCR + NOT) GÖRÜNÜR YAP --- */
    .pdf-mode #report-body > div:nth-child(2) {
      width: 100% !important;
      display: block !important;
    }
    /* İçindeki kartları (Öğrenci Yazısı, Öğretmen Notu) düzenle */
    .pdf-mode #report-body > div:nth-child(2) > div {
      border: 1px solid #eee !important;
      padding: 18px !important;
      margin-bottom: 14px !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #000 !important; /* Yazı rengini siyah yap */
      display: block !important; /* Görünürlüğü zorla */
    }

    /* Öğretmen notu textarea ayarı (ekranda textarea var; PDF'de div'e çevrildi ama kalsın) */
    .pdf-mode textarea {
      border: 1px solid #ccc !important;
      width: 100% !important;
      min-height: 100px !important;
      color: #000 !important;
      background: #fff !important;
      resize: none !important;
      overflow: hidden !important;
      padding: 10px !important;
    }

    /* ✅ Öğretmen notunu PDF’de AI kutusu gibi göster */
    .pdf-mode .pdf-teacher-note{
      width: 100% !important;
      border: 1px solid #eee !important;
      background: #fff !important;
      color: #000 !important;
      padding: 12px !important;
      border-radius: 10px !important;
      white-space: pre-wrap !important;
      line-height: 1.4 !important;
    }

    /* 3. PUAN VE HATALAR ALANI */
    .pdf-mode #report-body > div:nth-child(3) {
      width: 100% !important;
    }
    .pdf-mode #report-body > div:nth-child(3) > div {
      border: 1px solid #eee !important;
      padding: 18px !important;
      margin-bottom: 14px !important;
      box-shadow: none !important;
      background: #fff !important;
    }

    /* Yapay Zeka kartını gizle (class ile) */
    .pdf-mode .pdf-hide-ai { display: none !important; }
    .pdf-mode .pdf-hide-zoom-hint { display: none !important; }
    .pdf-mode button, .pdf-mode [role="button"] { display: none !important; }

    /* Sayfa Bölünme Koruması */
    .pdf-mode .avoid-break,
    .pdf-mode .avoid-break *{
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
  `;
  wrapper.appendChild(style);

  // 4) GİZLENEN HER ŞEYİ AÇ
  const ignored = clone.querySelectorAll('[data-html2canvas-ignore]');
  ignored.forEach(el => el.removeAttribute('data-html2canvas-ignore'));

  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  // ✅ PDF'de "Yapay Zeka Analizi" kartını GARANTİLİ gizle
  const aiHeaderEl = Array.from(clone.querySelectorAll("*")).find(el =>
    ((el.textContent || "").trim().toUpperCase() === "YAPAY ZEKA ANALİZİ")
  );

  if (aiHeaderEl) {
    // Yukarı doğru çıkıp gerçekten o "kart"ı bul
    let node = aiHeaderEl;
    for (let i = 0; i < 10 && node; i++) {
      const t = (node.textContent || "");
      // Kart içeriğini yakalayan güvenli şartlar
      if (
        t.includes("YAPAY ZEKA ANALİZİ") &&
        t.includes("Çabaların") &&                // analiz metninden tipik bir parça
        !t.includes("ÖĞRETMEN DEĞERLENDİRMESİ")   // öğretmen kartı değil
      ) {
        node.classList.add("pdf-hide-ai");
        break;
      }
      node = node.parentElement;
    }
  }

  // Zoom yazısını gizle
  clone.querySelectorAll("*").forEach((el) => {
    const txt = (el.textContent || "").trim();
    if (txt === "Büyütmek için tıkla") el.classList.add("pdf-hide-zoom-hint");
  });

  // ScoreEditor grid düzeltmesi
  clone.querySelectorAll("div").forEach((d) => {
    if (d.style && d.style.display === "grid") {
      d.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      d.style.gap = "8px";
    }
  });

  // 5) HTML2PDF AYARLARI
  const opt = {
    margin: [10, 10, 10, 10],
    filename: fileName,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: PDF_WIDTH,
      logging: false,
    },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["css", "legacy"] },
  };

  try {
    await html2pdf().set(opt).from(clone).save();
  } catch (e) {
    alert("Hata: " + e.message);
  } finally {
    document.body.removeChild(wrapper);
  }
};


  function calculateStats(data) { 
    let stats = { 'Dilbilgisi': 0, 'Söz Dizimi': 0, 'Yazım/Nokt.': 0, 'Kelime': 0 }; 
    let countries = {}; 

    data.forEach(sub => { 
      if (sub.analysis_json?.errors) { 
        sub.analysis_json.errors.forEach(err => { 
          const typeText = (err.type || "").toLowerCase();
          const descText = (err.explanation || "").toLowerCase();
          const fullText = typeText + " " + descText;

          if (fullText.includes('söz') || fullText.includes('cümle') || fullText.includes('yapı') || 
              fullText.includes('anlatım') || fullText.includes('devrik') || fullText.includes('yüklem') || 
              fullText.includes('özne') || fullText.includes('sıralama') || fullText.includes('eksik')) {
             stats['Söz Dizimi']++;
          } 
          else if (fullText.includes('yazım') || fullText.includes('nokta') || fullText.includes('harf') || 
                   fullText.includes('imla') || fullText.includes('büyük') || fullText.includes('küçük') || 
                   fullText.includes('kesme')) {
             stats['Yazım/Nokt.']++;
          } 
          else if (fullText.includes('keli') || fullText.includes('sözcük') || fullText.includes('anlam') || 
                   fullText.includes('seçim') || fullText.includes('ifade')) {
             stats['Kelime']++;
          } 
          else {
             stats['Dilbilgisi']++;
          }
        }); 
      } 
      const countryName = sub.country || 'Belirsiz'; 
      countries[countryName] = (countries[countryName] || 0) + 1; 
    }); 

    setChartData(Object.keys(stats).map(key => ({ name: key, HataSayisi: stats[key] }))); 
    setCountryData(Object.keys(countries).map(key => ({ name: key, value: countries[key] }))); 
  }

  // --- STİL AYARLARI (CSS) ---
  const globalStyles = `
    input, select, textarea {
        background-color: #ffffff !important;
        color: #000000 !important;
        border: 1px solid #cccccc !important;
    }
    
    /* PDF BÖLÜNME KORUMASI */
    .avoid-break {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
    }
  `;

  if (!session) { return ( <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', backgroundColor:'#f0f2f5', fontFamily: "'Segoe UI', sans-serif" }}> <div style={{ backgroundColor:'white', padding:40, borderRadius:15, boxShadow:'0 10px 25px rgba(0,0,0,0.05)', width:350, textAlign:'center' }}> <div style={{backgroundColor:'#e8f0fe', width:60, height:60, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px'}}><Lock size={30} color="#3498db"/></div> <h2 style={{color:'#2c3e50', marginBottom:10}}>Öğretmen Girişi</h2> <form onSubmit={handleLogin}> <input type="email" placeholder="E-posta Adresi" value={email} onChange={(e) => setEmail(e.target.value)} style={{width:'100%', padding:12, marginBottom:15, borderRadius:8, border:'1px solid #ddd', boxSizing:'border-box'}} required /> <input type="password" placeholder="Şifre" value={password} onChange={(e) => setPassword(e.target.value)} style={{width:'100%', padding:12, marginBottom:25, borderRadius:8, border:'1px solid #ddd', boxSizing:'border-box'}} required /> <button type="submit" disabled={loading} style={{width:'100%', padding:12, backgroundColor:'#3498db', color:'white', border:'none', borderRadius:8, fontWeight:'bold', cursor:'pointer', opacity: loading ? 0.7 : 1}}>{loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}</button> </form> </div> </div> ); }

  if (!selectedSubmission) {
    return (
      <div style={{ padding: '30px', fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
        <style>{globalStyles}</style>
        <div style={{marginBottom: 25, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div><h1 style={{ color: '#2c3e50', margin: 0, fontSize: 26, fontWeight:'700' }}>🎓 Öğretmen Kontrol Paneli</h1><p style={{ color: '#7f8c8d', margin: '5px 0 0 0', fontSize:14 }}>Hoşgeldiniz, {session.user.email}</p></div>
          <button onClick={handleLogout} style={{backgroundColor:'#e74c3c', color:'white', border:'none', padding:'8px 15px', borderRadius:10, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontWeight:'bold'}}><LogOut size={16}/> Çıkış</button>
        </div>

        <div style={{backgroundColor:'white', padding:15, borderRadius:12, marginBottom:25, boxShadow:'0 2px 10px rgba(0,0,0,0.03)', display:'flex', alignItems:'center', gap:15, flexWrap:'wrap'}}>
            <strong style={{color:'#34495e'}}>🏫 Sınıf Seçimi:</strong>
            <select value={selectedClassCode} onChange={(e) => setSelectedClassCode(e.target.value)} style={{padding:'8px 12px', borderRadius:6, border:'1px solid #ddd', fontFamily:'inherit', fontSize:14, minWidth:200}}><option value="ALL">Tüm Sınıflar</option>{classrooms.map(c => (<option key={c.id} value={c.code}>{c.name} ({c.code})</option>))}</select>
            {selectedClassCode !== "ALL" && !isEditingClass && ( <><button onClick={() => { setIsEditingClass(true); setEditClassName(classrooms.find(c => c.code === selectedClassCode)?.name); }} style={{backgroundColor:'#f39c12', color:'white', border:'none', padding:'8px 12px', borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontSize:13, fontWeight:'bold'}}><Edit3 size={14}/> Adı Değiştir</button> <button onClick={deleteClassroom} style={{backgroundColor:'#e74c3c', color:'white', border:'none', padding:'8px 12px', borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontSize:13, fontWeight:'bold'}}><Trash2 size={14}/> Sınıfı Sil</button></>)}
            {isEditingClass && (<div style={{display:'flex', gap:5, alignItems:'center'}}><input type="text" value={editClassName} onChange={(e) => setEditClassName(e.target.value)} style={{padding:'6px', borderRadius:4, border:'1px solid #f39c12'}}/><button onClick={updateClassroom} style={{backgroundColor:'#27ae60', color:'white', border:'none', padding:'6px 12px', borderRadius:4, cursor:'pointer', fontSize:12}}>Kaydet</button><button onClick={() => setIsEditingClass(false)} style={{backgroundColor:'#95a5a6', color:'white', border:'none', padding:'6px 12px', borderRadius:4, cursor:'pointer', fontSize:12}}>İptal</button></div>)}
            <div style={{flex:1}}></div>
            <button onClick={() => setShowCreateClass(!showCreateClass)} style={{backgroundColor:'#2ecc71', color:'white', border:'none', padding:'8px 15px', borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontSize:13, fontWeight:'bold'}}><Plus size={16}/> Yeni Sınıf</button>
            {showCreateClass && (<div style={{display:'flex', gap:10, alignItems:'center', backgroundColor:'#f9f9f9', padding:5, borderRadius:6, border:'1px solid #eee'}}><input type="text" placeholder="Sınıf Adı" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} style={{padding:'6px', borderRadius:4, border:'1px solid #ccc', fontSize:13}}/><button onClick={createClassroom} style={{backgroundColor:'#3498db', color:'white', border:'none', padding:'6px 12px', borderRadius:4, cursor:'pointer', fontSize:13}}>Kaydet</button></div>)}
        </div>

        <div style={{display:'flex', gap:25, marginBottom:25, flexDirection: window.innerWidth < 900 ? 'column' : 'row'}}>
            <div style={{ flex:2, backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}><h3 style={{marginTop:0, marginBottom:20, color:'#444', display:'flex', alignItems:'center', gap:10, fontSize:16}}><BarChart2 size={18} color="#6c5ce7"/> Hata Analizi (Türlere Göre)</h3><div style={{ width: '100%', height: 250 }}><ResponsiveContainer><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" /><XAxis dataKey="name" tick={{fontSize:12, fill:'#888'}} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{fontSize:12, fill:'#888'}} axisLine={false} tickLine={false} /><Tooltip cursor={{fill: '#f9f9f9'}} contentStyle={{borderRadius:8, border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}} /><Bar dataKey="HataSayisi" fill="#6c5ce7" radius={[4, 4, 0, 0]} barSize={50} /></BarChart></ResponsiveContainer></div></div>
            <div style={{ flex:1, backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}><h3 style={{marginTop:0, marginBottom:20, color:'#444', display:'flex', alignItems:'center', gap:10, fontSize:16}}><Globe size={18} color="#00C49F"/> Öğrenci Ülke Dağılımı</h3><div style={{ width: '100%', height: 250 }}><ResponsiveContainer><PieChart><Pie data={countryData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">{countryData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div></div>
        </div>

        <div style={{ width: '100%', backgroundColor: 'white', borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.03)', overflow:'hidden' }}>
           <div style={{padding:'20px 25px', borderBottom:'1px solid #f0f0f0'}}><h3 style={{margin:0, color:'#444', fontSize:16}}>📄 Son Yüklenen Ödevler ({filteredSubmissions.length})</h3></div>
           <div style={{overflowX:'auto'}}> 
             <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#fafafa', color:'#95a5a6', fontSize:12, textAlign:'left', letterSpacing:0.5 }}>
                  <th style={{ padding: '15px 25px' }}>TARİH</th>
                  <th style={{ padding: '15px 25px' }}>ÖĞRENCİ</th>
                  <th style={{ padding: '15px 25px' }}>SINIF</th>
                  <th style={{ padding: '15px 25px' }}>ÜLKE / DİL</th>
                  <th style={{ padding: '15px 25px' }}>PUAN</th>
                  <th style={{ padding: '15px 25px' }}>DURUM</th>
                  <th style={{ padding: '15px 25px' }}>İŞLEM</th>
                  <th style={{ padding: '15px 25px' }}>SİL</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.map((sub) => (
                  <tr key={sub.id} style={{ borderBottom: '1px solid #f9f9f9' }}>
                    <td style={{ padding: '15px 25px', color:'#2c3e50', fontSize:14 }}>{new Date(sub.created_at).toLocaleDateString('tr-TR')}</td>
                    <td style={{ padding: '15px 25px', fontSize:13, color:'#7f8c8d' }}>{sub.student_name ? <strong>{sub.student_name} {sub.student_surname}</strong> : 'Demo Öğrenci'}{sub.human_note && <span title="Öğretmen notu var" style={{marginLeft:5}}>📝</span>}</td>
                    <td style={{ padding: '15px 25px' }}>{sub.classroom_code ? <span style={{backgroundColor:'#f1f2f6', padding:'3px 8px', borderRadius:4, fontSize:12, fontWeight:'bold', color:'#34495e'}}>{sub.classroom_code}</span> : <span style={{color:'#bdc3c7', fontSize:12}}>-</span>}</td>
                    <td style={{ padding: '15px 25px', fontSize:14 }}><div style={{display:'flex', alignItems:'center', gap:8}}><span style={{fontSize:20}}>{getFlag(sub.country)}</span><span style={{backgroundColor:'#ecf0f1', padding:'2px 6px', borderRadius:4, fontSize:11, fontWeight:'bold', color:'#7f8c8d'}}>{sub.native_language || '?'}</span></div></td>
                    <td style={{ padding: '15px 25px' }}><span style={{backgroundColor: sub.score_total >= PASS_THRESHOLD ? '#e8f8f5' : '#fdedec', color: sub.score_total >= PASS_THRESHOLD ? '#27ae60' : '#c0392b', padding:'6px 12px', borderRadius:20, fontWeight:'bold', fontSize:13}}>{sub.score_total}</span></td>
                    <td style={{ padding: '15px 25px', fontSize:14 }}>{sub.score_total >= PASS_THRESHOLD ? '✅ Geçti' : '⚠️ Tekrar'}</td>
                    <td style={{ padding: '15px 25px' }}><button onClick={() => setSelectedSubmission(sub)} style={{ backgroundColor: '#34495e', color: 'white', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize:13, fontWeight:500 }}>İncele</button></td>
                    <td style={{ padding: '15px 25px' }}><button onClick={(e) => { e.stopPropagation(); deleteSubmission(sub.id, sub.student_name); }} style={{ backgroundColor: '#fff0f0', color: '#e74c3c', border: 'none', padding: '8px', borderRadius: 6, cursor: 'pointer' }}><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
           </div>
        </div>
      </div>
    );
  }

  const classInfo = classrooms.find(c => c.code === selectedSubmission.classroom_code);
  const className = classInfo ? classInfo.name : "Sınıf Adı Yok";

  return (
    <div style={{ padding: '30px', fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
      <style>{globalStyles}</style>
      
      {/* ZOOM MODAL */}
      {showImageModal && <ImageViewerModal src={selectedSubmission.image_url} onClose={() => setShowImageModal(false)} />}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 20 }}>
        <button onClick={() => setSelectedSubmission(null)} style={{ cursor:'pointer', border:'none', background:'none', color:'#3498db', fontWeight:'600', fontSize:15, display:'flex', alignItems:'center', gap:5 }}>← Panelle Dön</button>
        <button onClick={downloadPDF} style={{ backgroundColor:'#2c3e50', color:'white', padding:'10px 20px', borderRadius:8, border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:8, fontWeight:'bold' }}><Download size={18} /> Raporu PDF Olarak İndir</button>
      </div>
      
      {/* --- RESPONSIVE ÜST BİLGİ KARTI --- */}
      <div id="report-content" style={{ display: 'flex', gap: 25, alignItems:'flex-start', flexDirection: 'column' }}>
        <div style={{
            width:'100%', 
            backgroundColor:'white', 
            padding:'20px 25px', 
            borderRadius:12, 
            display:'flex', 
            flexDirection: isMobile ? 'column' : 'row', 
            alignItems: isMobile ? 'flex-start' : 'center', 
            gap:25, 
            boxShadow:'0 2px 10px rgba(0,0,0,0.03)', 
            boxSizing:'border-box', 
            borderLeft:'6px solid #3498db'
        }}>
            <div style={{fontSize:48, lineHeight:1}}>{getFlag(selectedSubmission.country)}</div>
            <div style={{flex: 1}}>
                <div style={{fontSize:22, fontWeight:'800', color:'#2c3e50', marginBottom:5}}>{selectedSubmission.student_name} {selectedSubmission.student_surname}</div>
                <div style={{display:'flex', gap:15, color:'#7f8c8d', fontSize:14}}>
                    <span style={{display:'flex', alignItems:'center', gap:5}}>🌍 {COUNTRY_NAMES[selectedSubmission.country] || selectedSubmission.country}</span>
                    <span style={{display:'flex', alignItems:'center', gap:5}}>🗣️ {selectedSubmission.native_language}</span>
                </div>
            </div>
            {/* SINIF BİLGİLERİ KISMI */}
            <div style={{
                display:'flex', 
                flexDirection:'column', 
                gap:8, 
                alignItems: isMobile ? 'flex-start' : 'flex-end',
                width: isMobile ? '100%' : 'auto',
                marginTop: isMobile ? 15 : 0
            }}>
                 <div style={{fontSize:12, color:'#95a5a6', fontWeight:'bold'}}>SINIF BİLGİLERİ</div>
                 <div style={{
                     display:'flex', 
                     gap:10, 
                     flexWrap: 'wrap' 
                 }}>
                     <div style={{backgroundColor:'#f1f2f6', padding:'6px 12px', borderRadius:6, textAlign:'center'}}><div style={{fontSize:10, color:'#7f8c8d', fontWeight:'bold'}}>SINIF</div><div style={{color:'#2c3e50', fontWeight:'bold'}}>{className}</div></div>
                     <div style={{backgroundColor:'#fff3cd', padding:'6px 12px', borderRadius:6, textAlign:'center', minWidth:50}}><div style={{fontSize:10, color:'#856404', fontWeight:'bold'}}>SEVİYE</div><div style={{color:'#856404', fontWeight:'bold'}}>{selectedSubmission.level || '-'}</div></div>
                     <div style={{backgroundColor:'#e8f0fe', padding:'6px 12px', borderRadius:6, textAlign:'center'}}><div style={{fontSize:10, color:'#3498db', fontWeight:'bold'}}>KOD</div><div style={{color:'#3498db', fontWeight:'bold', letterSpacing:1}}>{selectedSubmission.classroom_code}</div></div>
                 </div>
                 <div style={{fontSize:12, color:'#bdc3c7'}}>{new Date(selectedSubmission.created_at).toLocaleDateString('tr-TR')} tarihinde gönderildi</div>
            </div>
        </div>

        {/* --- 3 SÜTUNLU YAPI --- */}
        <div id="report-body" style={{display:'flex', gap:25, width:'100%', flexDirection: window.innerWidth < 1100 ? 'column' : 'row'}}>
            
            {/* 1. SÜTUN: ÖĞRENCİ KAĞIDI (RESİM) */}
            <div data-html2canvas-ignore="true" style={{ flex: 1, width:'100%' }} className="avoid-break">
                 <div style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', marginBottom:20, breakInside: 'avoid' }}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:15}}>
                        <h2 style={{ margin:0, color:'#2c3e50', fontSize:18 }}>📄 Öğrenci Kağıdı</h2>
                        <span style={{fontSize:12, color:'#7f8c8d', display:'flex', alignItems:'center', gap:5}}><Maximize2 size={12}/> Büyütmek için tıkla</span>
                    </div>
                    <div 
                        onClick={() => setShowImageModal(true)}
                        style={{
                            width: '100%', 
                            height: 400, // Sabit yükseklik
                            backgroundColor: '#f8f9fa', 
                            borderRadius: 8, 
                            border: '1px solid #eee',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'zoom-in',
                            overflow: 'hidden',
                            position: 'relative'
                        }}
                    >
                        {selectedSubmission.image_url ? (
                            <img 
                                src={selectedSubmission.image_url} 
                                alt="Ödev" 
                                style={{width:'100%', height:'100%', objectFit:'contain'}}
                            />
                        ) : (
                            <span style={{color:'#ccc'}}>Resim Yok</span>
                        )}
                        <div style={{position:'absolute', bottom:10, right:10, backgroundColor:'rgba(0,0,0,0.6)', color:'white', padding:'5px 10px', borderRadius:20, fontSize:11, display:'flex', alignItems:'center', gap:5}}>
                            <Maximize2 size={12}/> Büyüt
                        </div>
                    </div>
                 </div>
            </div>

            {/* 2. SÜTUN: OCR METİN & ANALİZ (MEVCUT) */}
            <div style={{ flex: 1, width:'100%' }} className="avoid-break">
                <div style={{ backgroundColor: 'white', padding: 30, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', marginBottom:20, breakInside: 'avoid' }}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}><h2 style={{ margin:0, color:'#2c3e50', fontSize:20 }}>📝 Öğrenci Yazısı</h2><span data-html2canvas-ignore="true" style={{backgroundColor:'#f1f2f6', padding:'5px 10px', borderRadius:5, fontSize:11, color:'#7f8c8d', fontWeight:'bold'}}>OCR TARAMASI</span></div>
                    <div style={{ backgroundColor:'#f8f9fa', padding:20, borderRadius:8, fontSize:16, lineHeight:1.6, color:'#2d3436', marginBottom:20, border:'1px solid #e9ecef', fontStyle:'italic' }}><HighlightedText text={selectedSubmission.ocr_text} errors={selectedSubmission.analysis_json?.errors} /></div>
                </div>
                <div data-html2canvas-ignore="true" style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', marginBottom:20, borderLeft:'5px solid #ffc107', breakInside: 'avoid' }}>
                    <strong style={{color:'#d35400', fontSize:12, textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:8}}>🤖 Yapay Zeka Analizi</strong><span style={{color:'#5e4a18', fontSize:15}}>{selectedSubmission.analysis_json?.teacher_note}</span>
                </div>
                <div style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', borderLeft:'5px solid #3498db', breakInside: 'avoid' }}>
                    <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}><Edit3 size={18} color="#2980b9"/><strong style={{color:'#2980b9', fontSize:14, textTransform:'uppercase', letterSpacing:1}}>Öğretmen Değerlendirmesi</strong></div>
                    <textarea value={teacherNote} onChange={(e) => setTeacherNote(e.target.value)} placeholder="Öğrenciye özel notunuzu buraya ekleyebilirsiniz..." style={{width:'100%', height:100, padding:10, borderRadius:8, border:'1px solid #bdc3c7', fontFamily:'inherit', fontSize:14, resize:'vertical'}}/>
                    <div data-html2canvas-ignore="true" style={{textAlign:'right', marginTop:10}}><button onClick={saveTeacherNote} disabled={isSaving} style={{backgroundColor:'#3498db', color:'white', border:'none', padding:'8px 20px', borderRadius:6, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, opacity: isSaving ? 0.7 : 1}}><Save size={16}/> {isSaving ? 'Kaydediliyor...' : 'Notu Kaydet'}</button></div>
                </div>
            </div>

            {/* 3. SÜTUN: PUANLAMA & HATALAR (MEVCUT) */}
            <div style={{ flex: 1, width:'100%' }} className="avoid-break">
                <div style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, marginBottom: 20, textAlign: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', breakInside: 'avoid' }}>
                    {/* --- DİNAMİK PUANLAMA ALANI --- */}
                    <div style={{ fontSize: 12, color: '#95a5a6', letterSpacing:1, fontWeight:'700', textTransform:'uppercase' }}>BAŞARI PUANI</div>
                    
                    <div style={{ fontSize: 64, fontWeight: '800', color: calculatedTotal >= PASS_THRESHOLD ? '#27ae60' : '#e74c3c', margin:'5px 0' }}>
                        {calculatedTotal}
                    </div>

                    {isScoreChanged && (
                        <div style={{marginBottom:10}}>
                            <button onClick={saveUpdatedScore} style={{backgroundColor:'#e67e22', color:'white', border:'none', padding:'8px 15px', borderRadius:20, fontWeight:'bold', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, fontSize:13}}>
                                <Save size={14}/> Yeni Puanı Kaydet
                            </button>
                        </div>
                    )}
                    
                    {/* Yeni Editör Bileşeni */}
                    <ScoreEditor rubric={editableRubric} onUpdate={handleRubricUpdate} />
                </div>

                <div style={{ backgroundColor: 'white', padding: 25, borderRadius: 12, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', breakInside: 'avoid' }}>
                    <h3 style={{marginTop:0, marginBottom:20, color:'#2c3e50', display:'flex', alignItems:'center', gap:8, fontSize:18}}><CheckCircle size={20} color="#e74c3c"/> Hatalar</h3>
                    {selectedSubmission.analysis_json?.errors?.length === 0 && <p style={{color:'#27ae60', textAlign:'center'}}>Hata bulunamadı. 🎉</p>}
                    {selectedSubmission.analysis_json?.errors?.map((err, i) => (
                        <div key={i} style={{ marginBottom: 15, borderBottom: '1px solid #f9f9f9', paddingBottom: 15, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom:6 }}><span style={{ textDecoration: 'line-through', color: '#e74c3c', fontSize:15, backgroundColor:'#fff0f0', padding:'2px 6px', borderRadius:4 }}>{err.wrong}</span><span style={{color:'#b2bec3', fontSize:12}}>➜</span><span style={{ fontWeight: 'bold', color: '#27ae60', fontSize:15, backgroundColor:'#f0fff4', padding:'2px 6px', borderRadius:4 }}>{err.correct}</span></div>
                        <div style={{ fontSize: 13, color: '#636e72', lineHeight:1.4 }}>{err.explanation}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}