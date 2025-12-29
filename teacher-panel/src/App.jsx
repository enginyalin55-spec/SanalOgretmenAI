import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  BarChart2, Save, Edit3, Globe, Download, LogOut, Lock,
  Plus, Trash2, CheckCircle, Maximize2, X
} from "lucide-react";
import html2pdf from "html2pdf.js";

/* ===================== AYARLAR ===================== */
const PASS_THRESHOLD = 70;
const API_URL = "https://sanalogretmenai.onrender.com";

const TDK_LOOKUP = {
  TDK_01_BAGLAC_DE: "Bağlaç Olan da/de",
  TDK_02_BAGLAC_KI: "Bağlaç Olan ki",
  TDK_03_SORU_EKI: "Soru Eki mı/mi",
  TDK_20_NOKTA: "Nokta Kullanımı",
  TDK_21_VIRGUL: "Virgül Kullanımı",
};

/* ===================== YARDIMCI ===================== */
const generateClassCode = () =>
  Math.random().toString(36).substring(2, 7).toUpperCase();

const normalizeSubmission = (sub) => {
  const aj = sub.analysis_json || {};
  const rubric =
    aj.rubric || { uzunluk:0, noktalama:0, dil_bilgisi:0, soz_dizimi:0, kelime:0, icerik:0 };

  const total =
    sub.score_total ??
    Object.values(rubric).reduce((a,b)=>a+(Number(b)||0),0);

  return {
    ...sub,
    score_total: total,
    analysis_json: {
      ...aj,
      rubric,
      errors: (aj.errors || []).map(e => ({
        wrong: e.wrong || "",
        correct: e.correct || "",
        explanation: e.explanation || "",
        rule_id: e.rule_id,
        span: e.span
      }))
    }
  };
};

/* ===================== HIGHLIGHT ===================== */
const HighlightedText = ({ text, errors, onError }) => {
  if (!text) return null;
  if (!errors?.length) return <div style={{whiteSpace:"pre-wrap"}}>{text}</div>;

  const spans = errors
    .filter(e => e.span)
    .sort((a,b)=>a.span.start - b.span.start);

  let out = [];
  let cursor = 0;

  spans.forEach((e,i)=>{
    const s = e.span.start;
    const end = e.span.end;
    if (s > cursor) out.push(text.slice(cursor,s));
    out.push(
      <span
        key={i}
        title={`${e.wrong} → ${e.correct}`}
        onClick={(ev)=>{
          const r = ev.target.getBoundingClientRect();
          onError(e, {x:r.left,y:r.bottom});
        }}
        style={{
          background:"#fff0f0",
          borderBottom:"2px solid #e74c3c",
          fontWeight:"bold",
          cursor:"pointer"
        }}
      >
        {text.slice(s,end)}
      </span>
    );
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <div style={{whiteSpace:"pre-wrap", lineHeight:1.7}}>{out}</div>;
};

/* ===================== ANA BİLEŞEN ===================== */
export default function TeacherPanel() {
  const [session,setSession]=useState(null);
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [loading,setLoading]=useState(false);

  const [classrooms,setClassrooms]=useState([]);
  const [selectedClass,setSelectedClass]=useState("ALL");
  const [submissions,setSubmissions]=useState([]);
  const [selectedSubmission,setSelectedSubmission]=useState(null);

  const [rubric,setRubric]=useState(null);
  const [total,setTotal]=useState(0);
  const [teacherNote,setTeacherNote]=useState("");
  const [activeError,setActiveError]=useState(null);

  /* ===================== AUTH ===================== */
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{
      setSession(data.session);
      if(data.session) fetchData();
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{
      setSession(s);
      if(s) fetchData();
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const fetchData = async ()=>{
    const {data:cls}=await supabase.from("classrooms").select("*");
    const {data:subs}=await supabase.from("submissions")
      .select("*").order("created_at",{ascending:false});
    setClassrooms(cls||[]);
    setSubmissions((subs||[]).map(normalizeSubmission));
  };

  /* ===================== LOGIN ===================== */
  const handleLogin=async(e)=>{
    e.preventDefault();
    setLoading(true);
    const {error}=await supabase.auth.signInWithPassword({email,password});
    if(error) alert(error.message);
    setLoading(false);
  };

  if(!session){
    return(
      <div style={{display:"flex",height:"100vh",justifyContent:"center",alignItems:"center",background:"#f0f2f5"}}>
        <form onSubmit={handleLogin} style={{background:"#fff",padding:40,borderRadius:12,width:320}}>
          <h2>Öğretmen Girişi</h2>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-posta" style={{width:"100%",marginBottom:10}}/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Şifre" style={{width:"100%",marginBottom:20}}/>
          <button disabled={loading} style={{width:"100%"}}>Giriş</button>
        </form>
      </div>
    );
  }

  /* ===================== PDF ===================== */
  const downloadPDF = async ()=>{
    const src=document.getElementById("report-content");
    if(!src) return;

    const clone=src.cloneNode(true);
    clone.classList.add("pdf-mode");

    const wrap=document.createElement("div");
    wrap.style.position="fixed";
    wrap.style.left="-10000px";
    wrap.style.top="0";
    wrap.style.background="white";

    const style=document.createElement("style");
    style.innerHTML=`
      .pdf-mode{width:720px;padding:24px;font-family:Segoe UI}
      .pdf-mode button{display:none}
      .pdf-mode #report-body{flex-direction:column}
    `;
    wrap.appendChild(style);
    wrap.appendChild(clone);
    document.body.appendChild(wrap);

    await html2pdf().set({
      filename:"rapor.pdf",
      html2canvas:{scale:2},
      jsPDF:{format:"a4",orientation:"portrait"}
    }).from(clone).save();

    document.body.removeChild(wrap);
  };

  /* ===================== DASHBOARD ===================== */
  if(!selectedSubmission){
    return(
      <div style={{padding:30}}>
        <h1>🎓 Öğretmen Paneli</h1>

        <select value={selectedClass} onChange={e=>setSelectedClass(e.target.value)}>
          <option value="ALL">Tüm Sınıflar</option>
          {classrooms.map(c=>(
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>

        <table width="100%" style={{marginTop:20}}>
          <thead>
            <tr>
              <th>Öğrenci</th>
              <th>Sınıf</th>
              <th>Puan</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {submissions
              .filter(s=>selectedClass==="ALL"||s.classroom_code===selectedClass)
              .map(s=>(
              <tr key={s.id}>
                <td>{s.student_name} {s.student_surname}</td>
                <td>{s.classroom_code}</td>
                <td>{s.score_total}</td>
                <td>
                  <button onClick={()=>{
                    setSelectedSubmission(s);
                    setRubric(s.analysis_json.rubric);
                    setTotal(s.score_total);
                    setTeacherNote(s.human_note||"");
                  }}>İncele</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  /* ===================== DETAY ===================== */
  return(
    <div style={{padding:30}}>
      <button onClick={()=>setSelectedSubmission(null)}>← Geri</button>
      <button onClick={downloadPDF}>PDF</button>

      <div id="report-content">
        <div id="report-body" style={{display:"flex",gap:20}}>

          <div style={{flex:1}}>
            <img src={selectedSubmission.image_url} style={{width:"100%"}}/>
          </div>

          <div style={{flex:1}}>
            <HighlightedText
              text={selectedSubmission.ocr_text}
              errors={selectedSubmission.analysis_json.errors}
              onError={(e)=>setActiveError(e)}
            />
            <textarea
              value={teacherNote}
              onChange={e=>setTeacherNote(e.target.value)}
              style={{width:"100%",height:100}}
            />
          </div>

          <div style={{flex:1}}>
            {Object.entries(rubric).map(([k,v])=>(
              <div key={k}>
                {k}
                <input
                  type="number"
                  value={v}
                  onChange={e=>{
                    const nv={...rubric,[k]:Number(e.target.value)||0};
                    setRubric(nv);
                    setTotal(Object.values(nv).reduce((a,b)=>a+b,0));
                  }}
                />
              </div>
            ))}
            <h2>{total}</h2>
          </div>

        </div>
      </div>
    </div>
  );
}
