import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Image, Alert, ScrollView, Platform,
  ActivityIndicator, TextInput, FlatList, Dimensions
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

// --- AYARLAR ---
const BASE_URL = 'https://sanalogretmenai.onrender.com';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const TDK_LOOKUP = {
  "TDK_01_BAGLAC_DE": "Bağlaç Olan 'da/de'",
  "TDK_02_BAGLAC_KI": "Bağlaç Olan 'ki'",
  "TDK_03_SORU_EKI_MI": "Soru Eki 'mı/mi'",
  "TDK_04_SEY_AYRI": "'Şey' Sözcüğü",
  "TDK_06_YA_DA": "'Ya da' Bağlacı",
  "TDK_07_HER_SEY": "'Her şey' Yazımı",
  "TDK_12_GEREKSIZ_BUYUK": "Gereksiz Büyük Harf",
  "TDK_20_KESME_OZEL_AD": "Özel İsim Kesme İşareti",
  "TDK_23_KESME_GENEL_YOK": "Cins İsim Kesme Yok",
  "TDK_40_COK": "'Çok' Yazımı",
  "TDK_41_HERKES": "'Herkes' Yazımı",
  "TDK_42_YALNIZ": "'Yalnız' Yazımı",
  "TDK_43_YANLIS": "'Yanlış' Yazımı",
  "TDK_44_BIRKAC": "'Birkaç' Yazımı",
  "TDK_45_HICBIR": "'Hiçbir' Yazımı",
  "TDK_46_PEKCOK": "'Pek çok' Yazımı",
  "TDK_47_INSALLAH": "'İnşallah' Yazımı",
  "TDK_HOS_GELDIN": "'Hoş geldin' Yazımı",
  "TDK_HOS_BULDUK": "'Hoş bulduk' Yazımı"
};

const UNCERTAINTY_CHAR = '⍰';
function normalizeNFC(text) { if (!text) return ""; try { return text.normalize('NFC'); } catch { return text; } }
function buildOcrUncertaintySpans(text) {
  const t = normalizeNFC(text); if (!t) return []; const spans = [];
  for (let i = 0; i < t.length; i++) { if (t[i] === UNCERTAINTY_CHAR) spans.push({ start: i, end: i + 1, kind: "char" }); }
  return spans;
}
function hasOcrUncertainty(text) { const t = normalizeNFC(text); return !!t && t.includes(UNCERTAINTY_CHAR); }

const showAlert = (title, message) => {
  if (Platform.OS === 'web') { setTimeout(() => { if (window.alert) window.alert(`${title}\n\n${message}`); else Alert.alert(title, message); }, 0); }
  else { Alert.alert(title, message); }
};

const OcrUncertaintyText = ({ text, onPressHint }) => {
  const spans = useMemo(() => buildOcrUncertaintySpans(text), [text]);
  if (!text) return null;
  if (!spans.length) return <Text style={styles.ocrText}>{text}</Text>;

  const parts = []; let cursor = 0;
  spans.forEach((sp, idx) => {
    const start = Math.max(0, sp.start), end = Math.min(text.length, sp.end);
    if (start >= end || start < cursor) return;
    if (start > cursor) parts.push({ type: "text", key: `t-${cursor}`, content: text.slice(cursor, start) });
    parts.push({ type: "hint", key: `h-${idx}`, content: text.slice(start, end), span: sp });
    cursor = end;
  });
  if (cursor < text.length) parts.push({ type: "text", key: `t-end`, content: text.slice(cursor) });

  return <Text style={styles.ocrText}>{parts.map(p => p.type === "text" ? <Text key={p.key}>{p.content}</Text> : <Text key={p.key} style={styles.ocrHintInline} onPress={() => onPressHint?.(p.span)}>{p.content}</Text>)}</Text>;
};

const HighlightedText = ({ text, errors, onErrorPress }) => {
  if (!text) return null;
  const safeErrors = (errors || []).filter(e => e?.span?.start !== undefined).sort((a, b) => a.span.start - b.span.start);
  if (safeErrors.length === 0) return <Text style={styles.ocrText}>{text}</Text>;

  const parts = []; let cursor = 0;
  safeErrors.forEach((err, index) => {
    const start = Math.max(0, err.span.start); let end = err.span.end;
    if (end > text.length) end = text.length;
    if (start >= end || start < cursor) return;
    if (start > cursor) parts.push({ type: "text", key: `t-${cursor}`, content: text.slice(cursor, start) });
    
    const isSuspect = err.severity === "SUSPECT" || err.suggestion_type === "FLAG";
    parts.push({ type: "error", key: `e-${index}`, content: text.slice(start, end), errorData: err, isSuspect });
    cursor = end;
  });
  if (cursor < text.length) parts.push({ type: "text", key: "t-end", content: text.slice(cursor) });

  return (
    <Text style={styles.ocrText}>
      {parts.map(p => {
        if (p.type === "text") return <Text key={p.key}>{p.content}</Text>;
        return (
          <Text key={p.key} style={p.isSuspect ? styles.ocrSuspectInline : styles.errorInline} onPress={() => onErrorPress?.(p.errorData)}>
            {p.content}
          </Text>
        );
      })}
    </Text>
  );
};

const ErrorPopover = ({ data, onClose }) => {
  if (!data?.err) return null; const { err, x, y } = data;
  const ruleTitle = TDK_LOOKUP[err.rule_id] || err.rule_id || "Kural İhlali";
  let left = x - 150, top = y + 35;
  if (left < 10) left = 10; if (left + 300 > SCREEN_WIDTH) left = SCREEN_WIDTH - 310;
  if (top + 250 > SCREEN_HEIGHT) top = y - 260;

  return (
    <View style={styles.popoverContainer}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.popover, { left, top }]}>
        <View style={styles.popoverHeader}>
          <Text style={styles.popoverTitle}>⚠️ DETAY</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
        </View>
        <View style={styles.compareBox}>
          <View style={styles.compareItem}><Text style={styles.compareLabel}>METİNDEKİ</Text><Text style={styles.wrongText}>{err.wrong}</Text></View>
          <Text style={styles.arrow}>➜</Text>
          <View style={styles.compareItem}>
            <Text style={styles.compareLabel}>{err.suggestion_type === "FLAG" ? "ÖNERİ" : "DOĞRUSU"}</Text>
            <Text style={styles.correctText}>{err.correct || "(Düzeltme Yok)"}</Text>
          </View>
        </View>
        <View style={styles.ruleInfoBox}><Text style={styles.ruleInfoLabel}>KURAL:</Text><Text style={styles.ruleInfoText}>{ruleTitle}</Text></View>
        <Text style={styles.explanationText}>{err.explanation}</Text>
      </View>
    </View>
  );
};

const OcrHintPopover = ({ data, onClose }) => {
  if (!data?.span) return null; const { x, y } = data;
  let left = x - 150, top = y + 35;
  if (left < 10) left = 10; if (left + 300 > SCREEN_WIDTH) left = SCREEN_WIDTH - 310;
  
  return (
    <View style={styles.popoverContainer}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.popover, { left, top }]}>
        <Text style={[styles.popoverTitle, { color: '#d97706', marginBottom: 5 }]}>ℹ️ OKUNAMADI</Text>
        <Text style={{ fontSize: 13 }}>Yapay zeka burayı net okuyamadı. Lütfen elle düzeltin.</Text>
      </View>
    </View>
  );
};

export default function MainScreen({ user, setUser }) {
  const [activeTab, setActiveTab] = useState('new');
  const [historyData, setHistoryData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);
  const [showDetailOverlay, setShowDetailOverlay] = useState(false);
  const [activeErrorData, setActiveErrorData] = useState(null);
  const [activeOcrHintData, setActiveOcrHintData] = useState(null);
  const [step, setStep] = useState(1);
  const [image, setImage] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [result, setResult] = useState(null);

  if (!user) return <View style={styles.center}><ActivityIndicator size="large" /><Text>Yükleniyor...</Text></View>;
  const { studentName, studentSurname, studentLevel, classCode } = user;

  const handleLogout = async () => { try { await AsyncStorage.clear(); setUser(null); } catch (e) {} };

  // --- Yardımcı Fonksiyonlar ---
  const handleOpenOcrHint = (span, coords) => { 
    const position = coords || { x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 };
    setActiveOcrHintData({ span, ...position }); 
  };
  
  const handleOpenPopover = (err, coords) => {
     const position = coords || { x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 };
     setActiveErrorData({ err, ...position });
  };

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const fd = new FormData(); fd.append('student_name', studentName); fd.append('student_surname', studentSurname); fd.append('classroom_code', classCode);
      const res = await axios.post(`${BASE_URL}/student-history`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.status === 'success') setHistoryData(res.data.data);
    } catch (e) { console.error(e); } finally { setLoadingHistory(false); }
  };
  useEffect(() => { if (activeTab === 'history') fetchHistory(); }, [activeTab]);

  const resetFlow = () => { setStep(1); setImage(null); setOcrText(""); setResult(null); setImageUrl(""); setActiveErrorData(null); setActiveOcrHintData(null); };

  const takePhoto = async () => {
    const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return showAlert("İzin", "Kamera izni gerekli.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaType.Images, allowsEditing: true, quality: 0.7, base64: true });
    if (!r.canceled) { resetFlow(); setImage(r.assets[0]); }
  };
  
  const pickImage = async () => {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!p.granted) return showAlert("İzin", "Galeri izni gerekli.");
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaType.Images, allowsEditing: true, quality: 0.7, base64: true });
    if (!r.canceled) { resetFlow(); setImage(r.assets[0]); }
  };

  const startOCR = async () => {
    if (!image) return showAlert("Uyarı", "Fotoğraf seçin.");
    setLoading(true);
    try {
      const fd = new FormData();
      let uri = image.uri, name = uri.split('/').pop() || "upload.jpg";
      if (Platform.OS === 'web') { const res = await fetch(uri); const blob = await res.blob(); fd.append('file', blob, name); }
      else fd.append('file', { uri, name, type: 'image/jpeg' });
      fd.append('classroom_code', classCode);
      
      const res = await axios.post(`${BASE_URL}/ocr`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.status === "success") { setOcrText(normalizeNFC(res.data.ocr_text)); setImageUrl(res.data.image_url); setStep(2); }
    } catch (e) { showAlert("Hata", "OCR başarısız."); } finally { setLoading(false); }
  };

  const startAnalysis = async () => {
    if (!ocrText.trim()) return showAlert("Hata", "Metin boş.");
    if (hasOcrUncertainty(ocrText)) return showAlert("Düzeltme Gerekli", "Lütfen turuncu ⍰ işaretlerini düzeltin.");
    setLoading(true);
    try {
      const payload = { ocr_text: ocrText, image_url: imageUrl, student_name: studentName, student_surname: studentSurname, classroom_code: classCode, level: studentLevel, country: user.studentCountry, native_language: user.studentLanguage };
      const res = await axios.post(`${BASE_URL}/analyze`, payload);
      if (res.data.status === "success") { setResult(res.data.data); setStep(3); }
    } catch (e) { showAlert("Hata", "Analiz başarısız."); } finally { setLoading(false); }
  };

  const getCombinedErrors = (res) => {
    if (!res) return [];
    const list1 = res.errors_student || [];
    const list2 = res.errors_ocr || [];
    const list3 = res.errors || [];
    const all = [...list1, ...list2, ...list3];
    return all.sort((a,b) => (a.span?.start||0) - (b.span?.start||0));
  };

  const displayErrors = step === 3 ? getCombinedErrors(result) : [];
  const historyErrors = selectedHistoryItem ? getCombinedErrors(selectedHistoryItem.analysis_json) : [];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View><Text style={styles.name}>{studentName} {studentSurname}</Text><Text style={styles.badgeText}>{classCode} • {studentLevel}</Text></View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}><Text style={styles.logoutText}>Çıkış</Text></TouchableOpacity>
        </View>

        <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, activeTab==='new'&&styles.activeTab]} onPress={()=>setActiveTab('new')}><Text>📝 Yeni Ödev</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab==='history'&&styles.activeTab]} onPress={()=>setActiveTab('history')}><Text>📂 Geçmiş</Text></TouchableOpacity>
        </View>

        {activeTab === 'new' && (
          <View style={styles.contentArea}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{step===1?"1. Fotoğraf":step===2?"2. Kontrol":"3. Sonuç"}</Text>
              {image && <View style={styles.previewContainer}><Image source={{uri:image.uri}} style={styles.previewImage}/></View>}
              
              {step === 1 && (
                <>
                  <View style={styles.buttonRow}>
                    <TouchableOpacity style={[styles.actionButton, {backgroundColor:'#3498db'}]} onPress={takePhoto}><Text style={styles.btnText}>📷 Kamera</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.actionButton, {backgroundColor:'#9b59b6'}]} onPress={pickImage}><Text style={styles.btnText}>🖼️ Galeri</Text></TouchableOpacity>
                  </View>
                  <TouchableOpacity style={[styles.sendButton, {opacity:image?1:0.5}]} onPress={startOCR} disabled={!image||loading}>{loading?<ActivityIndicator color="white"/>:<Text style={styles.sendButtonText}>Tara</Text>}</TouchableOpacity>
                </>
              )}

              {step === 2 && (
                <View style={{width:'100%'}}>
                  <View style={styles.ocrBanner}><Text style={styles.ocrBannerText}>⚠️ Lütfen turuncu ⍰ yerleri ve yanlış kelimeleri elle düzeltin.</Text></View>
                  <View style={styles.ocrPreviewCard}><OcrUncertaintyText text={ocrText} onPressHint={(span)=>setActiveOcrHintData({span, x:SCREEN_WIDTH/2, y:SCREEN_HEIGHT/2})} /></View>
                  <TextInput style={styles.ocrInput} multiline value={ocrText} onChangeText={t=>setOcrText(normalizeNFC(t))} />
                  <TouchableOpacity style={[styles.sendButton, {marginTop:15, backgroundColor:'#27ae60'}]} onPress={startAnalysis} disabled={loading}>{loading?<ActivityIndicator color="white"/>:<Text style={styles.sendButtonText}>Analiz Et</Text>}</TouchableOpacity>
                  <TouchableOpacity onPress={resetFlow} style={{alignItems:'center', marginTop:15}}><Text style={{color:'#e74c3c'}}>İptal</Text></TouchableOpacity>
                </View>
              )}
            </View>

            {step === 3 && result && (
              <View style={styles.resultContainer}>
                <View style={styles.successBox}>
                  <Text style={styles.successText}>Analiz Tamamlandı! ✅</Text>
                  <Text style={styles.successSubText}>{displayErrors.length > 0 ? "Hatalar ve şüpheli yerler aşağıdadır." : "Harika! Hiç hata bulunamadı. 🎉"}</Text>
                </View>
                <View style={styles.analysisCard}>
                  <HighlightedText text={ocrText} errors={displayErrors} onErrorPress={(err)=>setActiveErrorData({err, x:SCREEN_WIDTH/2, y:SCREEN_HEIGHT/2})} />
                </View>
                {displayErrors.map((err, index) => (
                  <TouchableOpacity key={index} style={styles.errorItem} onPress={()=>setActiveErrorData({err, x:SCREEN_WIDTH/2, y:SCREEN_HEIGHT/2})}>
                    <Text style={styles.errorText}>
                      <Text style={{textDecorationLine:'line-through', color: err.suggestion_type==="FLAG"?'#d35400':'#e74c3c'}}>{err.wrong}</Text>
                      {' ➜ '}
                      <Text style={{fontWeight:'bold', color: err.suggestion_type==="FLAG"?'#e67e22':'#2ecc71'}}>{err.correct || "?"}</Text>
                    </Text>
                    <Text style={styles.errorDesc}>{err.explanation}</Text>
                    {err.suggestion_type==="FLAG" && <Text style={{fontSize:10, color:'#d35400', fontWeight:'bold'}}>⚠️ ŞÜPHELİ DURUM</Text>}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={resetFlow} style={[styles.sendButton, {backgroundColor:'#34495e', marginTop:20}]}><Text style={styles.sendButtonText}>Yeni Yükle</Text></TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.contentArea}>
            <FlatList data={historyData} keyExtractor={item=>item.id.toString()} renderItem={({item}) => (
              <View style={styles.historyCard}>
                <Text style={{fontWeight:'bold'}}>{new Date(item.created_at).toLocaleDateString('tr-TR')}</Text>
                <TouchableOpacity onPress={()=>{setSelectedHistoryItem(item); setShowDetailOverlay(true);}} style={{backgroundColor:'#3498db', padding:10, borderRadius:8, marginTop:5}}><Text style={{color:'white'}}>Rapor</Text></TouchableOpacity>
              </View>
            )} />
          </View>
        )}
      </ScrollView>

      {showDetailOverlay && selectedHistoryItem && (
        <View style={styles.fullScreenOverlay}>
          <View style={styles.detailContainer}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Rapor</Text><TouchableOpacity onPress={()=>setShowDetailOverlay(false)}><Text>✕</Text></TouchableOpacity></View>
            <ScrollView contentContainerStyle={{padding:20}}>
              <View style={styles.analysisCard}>
                <HighlightedText text={selectedHistoryItem.ocr_text} errors={historyErrors} onErrorPress={(err)=>setActiveErrorData({err, x:SCREEN_WIDTH/2, y:SCREEN_HEIGHT/2})} />
              </View>
              {historyErrors.map((err, index) => (
                <TouchableOpacity key={index} style={styles.errorItem} onPress={()=>setActiveErrorData({err, x:SCREEN_WIDTH/2, y:SCREEN_HEIGHT/2})}>
                  <Text style={styles.errorText}><Text style={{textDecorationLine:'line-through', color:'#e74c3c'}}>{err.wrong}</Text> ➜ {err.correct}</Text>
                  <Text style={styles.errorDesc}>{err.explanation}</Text>
                </TouchableOpacity>
              ))}
              {selectedHistoryItem.analysis_json?.teacher_note && <View style={styles.noteCard}><Text style={styles.noteTitle}>Not:</Text><Text>{selectedHistoryItem.analysis_json.teacher_note}</Text></View>}
            </ScrollView>
          </View>
        </View>
      )}
      
      {activeErrorData && <ErrorPopover data={activeErrorData} onClose={()=>setActiveErrorData(null)} />}
      {activeOcrHintData && <OcrHintPopover data={activeOcrHintData} onClose={()=>setActiveOcrHintData(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex:1, backgroundColor:'#f5f6fa', paddingTop:40}, center:{flex:1,justifyContent:'center',alignItems:'center'},
  scrollContent:{paddingBottom:50}, header:{padding:20, backgroundColor:'white', flexDirection:'row', justifyContent:'space-between'},
  name:{fontSize:18, fontWeight:'bold'}, badgeText:{color:'#7f8c8d', fontSize:12}, logoutButton:{padding:5}, logoutText:{color:'red'},
  tabsContainer:{flexDirection:'row', margin:20, backgroundColor:'white', borderRadius:10}, tab:{flex:1, padding:15, alignItems:'center'}, activeTab:{borderBottomWidth:2, borderColor:'#3498db'},
  contentArea:{paddingHorizontal:20}, card:{backgroundColor:'white', borderRadius:15, padding:20, marginBottom:20}, cardTitle:{fontSize:18, fontWeight:'bold', marginBottom:15},
  previewContainer:{height:200, borderRadius:10, overflow:'hidden', marginBottom:15}, previewImage:{width:'100%', height:'100%', resizeMode:'contain'},
  buttonRow:{flexDirection:'row', gap:10, marginBottom:15}, actionButton:{flex:1, padding:15, borderRadius:10, alignItems:'center'}, btnText:{color:'white', fontWeight:'bold'},
  sendButton:{backgroundColor:'#2ecc71', padding:15, borderRadius:10, alignItems:'center'}, sendButtonText:{color:'white', fontWeight:'bold'},
  ocrBanner:{backgroundColor:'#fff7ed', padding:10, borderRadius:8, marginBottom:10}, ocrBannerText:{color:'#d97706', fontSize:12},
  ocrPreviewCard:{backgroundColor:'#f8f9fa', padding:10, borderRadius:8, marginBottom:10}, ocrText:{fontSize:16, lineHeight:24, color:'#2c3e50'},
  ocrHintInline:{color:'#d97706', fontWeight:'bold', textDecorationLine:'underline'}, 
  
  errorInline:{color:'#c0392b', fontWeight:'bold', backgroundColor:'#fff0f0', textDecorationLine:'underline', textDecorationColor:'#e74c3c'},
  ocrSuspectInline:{color:'#d35400', fontWeight:'bold', backgroundColor:'#fff7ed', textDecorationLine:'underline', textDecorationColor:'#f39c12'},
  
  ocrInput:{backgroundColor:'white', borderWidth:1, borderColor:'#ddd', padding:10, borderRadius:8, minHeight:100, textAlignVertical:'top'},
  resultContainer:{width:'100%'}, successBox:{backgroundColor:'#e8f8f5', padding:15, borderRadius:10, marginBottom:15}, successText:{color:'#27ae60', fontWeight:'bold', textAlign:'center'},
  successSubText:{textAlign:'center', fontSize:12, color:'#555'}, analysisCard:{backgroundColor:'white', padding:15, borderRadius:10, marginBottom:15},
  errorItem:{padding:15, backgroundColor:'white', borderRadius:8, marginBottom:10, borderBottomWidth:1, borderColor:'#eee'}, errorText:{fontSize:16, marginBottom:5}, errorDesc:{color:'#7f8c8d', fontSize:12},
  historyCard:{padding:15, backgroundColor:'white', borderRadius:10, marginBottom:10},
  fullScreenOverlay:{position:'absolute', top:0, bottom:0, left:0, right:0, backgroundColor:'#f5f6fa', zIndex:99}, detailContainer:{flex:1, paddingTop:40},
  sheetHeader:{flexDirection:'row', justifyContent:'space-between', padding:20}, sheetTitle:{fontSize:20, fontWeight:'bold'},
  noteCard:{backgroundColor:'#fff3cd', padding:15, borderRadius:10, marginTop:10}, noteTitle:{fontWeight:'bold', color:'#856404'},
  popoverContainer:{position:'absolute', top:0, bottom:0, left:0, right:0, zIndex:999}, backdrop:{width:'100%', height:'100%'},
  popover:{position:'absolute', width:280, backgroundColor:'white', padding:15, borderRadius:10, elevation:5},
  popoverTitle:{fontWeight:'bold', marginBottom:5}, compareBox:{flexDirection:'row', alignItems:'center', marginVertical:10, backgroundColor:'#f9f9f9', padding:5},
  compareItem:{flex:1}, compareLabel:{fontSize:10, fontWeight:'bold'}, wrongText:{color:'red', textDecorationLine:'line-through'}, correctText:{color:'green', fontWeight:'bold'}, arrow:{marginHorizontal:5},
  ruleInfoBox:{flexDirection:'row', marginBottom:5}, ruleInfoLabel:{fontWeight:'bold', fontSize:10, marginRight:5}, ruleInfoText:{fontSize:12}, explanationText:{fontSize:13},
  closeBtnText:{fontSize:18, color:'#999'}
});