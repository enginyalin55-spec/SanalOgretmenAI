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

// --- TDK KURAL SÖZLÜĞÜ ---
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

// --- OCR BELİRSİZLİK ---
const UNCERTAINTY_CHAR = '⍰';

function normalizeNFC(text) { 
  if (!text) return ""; 
  try { return text.normalize('NFC'); } catch { return text; } 
}

function buildOcrUncertaintySpans(text) {
  const t = normalizeNFC(text); 
  if (!t) return []; 
  const spans = [];
  for (let i = 0; i < t.length; i++) { 
    if (t[i] === UNCERTAINTY_CHAR) {
      spans.push({ start: i, end: i + 1, kind: "char" }); 
    }
  }
  return spans;
}

function hasOcrUncertainty(text) { 
  const t = normalizeNFC(text); 
  return !!t && t.includes(UNCERTAINTY_CHAR); 
}

// --- UYARI FONKSİYONU ---
const showAlert = (title, message) => {
  if (Platform.OS === 'web') { 
    setTimeout(() => { 
      if (typeof window !== 'undefined' && window.alert) {
        window.alert(`${title}\n\n${message}`); 
      } else {
        Alert.alert(title, message); 
      }
    }, 0); 
  } else { 
    Alert.alert(title, message); 
  }
};

// =======================================================
// BİLEŞENLER
// =======================================================

// ✅ DÜZELTME: onPressHint prop olarak alınıyor ve doğru kullanılıyor
const OcrUncertaintyText = ({ text, onPressHint }) => {
  const spans = useMemo(() => buildOcrUncertaintySpans(text), [text]);
  if (!text) return null;
  if (!spans.length) return <Text style={styles.ocrText}>{text}</Text>;

  const parts = []; 
  let cursor = 0;
  
  spans.forEach((sp, idx) => {
    const start = Math.max(0, sp.start);
    const end = Math.min(text.length, sp.end);
    if (start >= end || start < cursor) return;
    
    if (start > cursor) {
      parts.push({ type: "text", key: `t-${cursor}`, content: text.slice(cursor, start) });
    }
    // ✅ BURASI DÜZELTİLDİ: handleOpenOcrHint yerine onPressHint kullanılıyor
    parts.push({ type: "hint", key: `h-${idx}`, content: text.slice(start, end), span: sp });
    cursor = end;
  });
  
  if (cursor < text.length) {
    parts.push({ type: "text", key: `t-end`, content: text.slice(cursor) });
  }

  return (
    <Text style={styles.ocrText}>
      {parts.map(p => 
        p.type === "text" 
          ? <Text key={p.key}>{p.content}</Text> 
          : <Text key={p.key} style={styles.ocrHintInline} onPress={() => onPressHint?.(p.span)}>{p.content}</Text>
      )}
    </Text>
  );
};

const HighlightedText = ({ text, errors, onErrorPress }) => {
  if (!text) return null;
  const safeErrors = (errors || []).filter(e => e?.span?.start !== undefined).sort((a, b) => a.span.start - b.span.start);
  if (safeErrors.length === 0) return <Text style={styles.ocrText}>{text}</Text>;

  const parts = []; 
  let cursor = 0;
  
  safeErrors.forEach((err, index) => {
    const start = Math.max(0, err.span.start); 
    let end = err.span.end;
    if (end > text.length) end = text.length;
    if (start >= end || start < cursor) return;
    
    if (start > cursor) {
      parts.push({ type: "text", key: `t-${cursor}`, content: text.slice(cursor, start) });
    }
    
    const isSuspect = err.severity === "SUSPECT" || err.suggestion_type === "FLAG";
    parts.push({ 
      type: "error", 
      key: `e-${index}`, 
      content: text.slice(start, end), 
      errorData: err, 
      isSuspect 
    });
    cursor = end;
  });
  
  if (cursor < text.length) {
    parts.push({ type: "text", key: "t-end", content: text.slice(cursor) });
  }

  return (
    <Text style={styles.ocrText}>
      {parts.map(p => {
        if (p.type === "text") return <Text key={p.key}>{p.content}</Text>;
        return (
          <Text 
            key={p.key} 
            style={p.isSuspect ? styles.ocrSuspectInline : styles.errorInline} 
            onPress={() => onErrorPress?.(p.errorData)}
          >
            {p.content}
          </Text>
        );
      })}
    </Text>
  );
};

// Popover Bileşenleri
const ErrorPopover = ({ data, onClose }) => {
  if (!data?.err) return null; 
  const { err, x, y } = data;
  const ruleTitle = TDK_LOOKUP[err.rule_id] || err.rule_id || "Kural İhlali";
  
  let left = x - 150, top = y + 35;
  if (left < 10) left = 10; 
  if (left + 300 > SCREEN_WIDTH) left = SCREEN_WIDTH - 310;
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
          <View style={styles.compareItem}>
            <Text style={styles.compareLabel}>METİNDEKİ</Text>
            <Text style={styles.wrongText}>{err.wrong}</Text>
          </View>
          <Text style={styles.arrow}>➜</Text>
          <View style={styles.compareItem}>
            <Text style={styles.compareLabel}>{err.suggestion_type === "FLAG" ? "ÖNERİ" : "DOĞRUSU"}</Text>
            <Text style={styles.correctText}>{err.correct || "(Düzeltme Yok)"}</Text>
          </View>
        </View>
        <View style={styles.ruleInfoBox}>
          <Text style={styles.ruleInfoLabel}>KURAL:</Text>
          <Text style={styles.ruleInfoText}>{ruleTitle}</Text>
        </View>
        <Text style={styles.explanationText}>{err.explanation}</Text>
      </View>
    </View>
  );
};

const OcrHintPopover = ({ data, onClose }) => {
  if (!data?.span) return null; 
  const { x, y } = data;
  let left = x - 150, top = y + 35;
  if (left < 10) left = 10; 
  if (left + 300 > SCREEN_WIDTH) left = SCREEN_WIDTH - 310;
  
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

// =======================================================
// MAIN SCREEN
// =======================================================
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
    // Koordinatlar web/mobil uyumu için
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
      const fd = new FormData(); 
      fd.append('student_name', studentName); 
      fd.append('student_surname', studentSurname); 
      fd.append('classroom_code', classCode);
      const res = await axios.post(`${BASE_URL}/student-history`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.status === 'success') setHistoryData(res.data.data);
    } catch (e) { console.error(e); } finally { setLoadingHistory(false); }
  };
  
  useEffect(() => { if (activeTab === 'history') fetchHistory(); }, [activeTab]);

  const resetFlow = () => { 
    setStep(1); setImage(null); setOcrText(""); setResult(null); setImageUrl(""); setActiveErrorData(null); setActiveOcrHintData(null); 
  };

  const takePhoto = async () => {
    const p = await ImagePicker.requestCameraPermissionsAsync(); 
    if (!p.granted) return showAlert("İzin", "Kamera izni gerekli.");
    // ✅ DÜZELTME: MediaTypeOptions -> MediaType
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaType.Images, allowsEditing: true, quality: 0.7, base64: true });
    if (!r.canceled) { resetFlow(); setImage(r.assets[0]); }
  };
  
  const pickImage = async () => {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync(); 
    if (!p.granted) return showAlert("İzin", "Galeri izni gerekli.");
    // ✅ DÜZELTME: MediaTypeOptions -> MediaType
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaType.Images, allowsEditing: true, quality: 0.7, base64: true });
    if (!r.canceled) { resetFlow(); setImage(r.assets[0]); }
  };

  const startOCR = async () => {
    if (!image) return showAlert("Uyarı", "Fotoğraf seçin.");
    setLoading(true);
    try {
      const fd = new FormData();
      let uri = image.uri, name = uri.split('/').pop() || "upload.jpg";
      if (Platform.OS === 'web') { 
        const res = await fetch(uri); 
        const blob = await res.blob(); 
        fd.append('file', blob, name); 
      } else {
        fd.append('file', { uri, name, type: 'image/jpeg' });
      }
      fd.append('classroom_code', classCode);
      
      const res = await axios.post(`${BASE_URL}/ocr`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.status === "success") { 
        setOcrText(normalizeNFC(res.data.ocr_text)); 
        setImageUrl(res.data.image_url); 
        setStep(2); 
      }
    } catch (e) { showAlert("Hata", "OCR başarısız."); } finally { setLoading(false); }
  };

  const startAnalysis = async () => {
    if (!ocrText.trim()) return showAlert("Hata", "Metin boş.");
    if (hasOcrUncertainty(ocrText)) return showAlert("Düzeltme Gerekli", "Lütfen turuncu ⍰ işaretli yerleri düzeltin.");
    setLoading(true);
    try {
      const payload = { 
        ocr_text: ocrText, image_url: imageUrl, 
        student_name: studentName, student_surname: studentSurname, 
        classroom_code: classCode, level: studentLevel, 
        country: user.studentCountry, native_language: user.studentLanguage 
      };
      const res = await axios.post(`${BASE_URL}/analyze`, payload);
      if (res.data.status === "success") { setResult(res.data.data); setStep(3); }
    } catch (e) { showAlert("Hata", "Analiz başarısız."); } finally { setLoading(false); }
  };

  // ✅ HATA LİSTESİ BİRLEŞTİRME
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
          <View>
            <Text style={styles.greeting}>Merhaba,</Text>
            <Text style={styles.name}>{studentName} {studentSurname}</Text>
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 5 }}>
              <View style={styles.badgeContainer}><Text style={styles.badgeText}>{classCode}</Text></View>
              <View style={[styles.badgeContainer, { backgroundColor: '#fff3cd' }]}><Text style={[styles.badgeText, { color: '#856404' }]}>{studentLevel}</Text></View>
            </View>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Çıkış</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'new' && styles.activeTab]} onPress={() => setActiveTab('new')}>
            <Text style={[styles.tabText, activeTab === 'new' && styles.activeTabText]}>📝 Yeni Ödev</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'history' && styles.activeTab]} onPress={() => setActiveTab('history')}>
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>📂 Geçmiş</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'new' && (
          <View style={styles.contentArea}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{step===1?"1. Fotoğraf":step===2?"2. Kontrol":"3. Sonuç"}</Text>
              
              {image && (
                <View style={styles.previewContainer}>
                  <Image source={{ uri: image.uri }} style={styles.previewImage} />
                  {step === 1 && <TouchableOpacity style={styles.removeButton} onPress={resetFlow}><Text style={styles.removeButtonText}>X</Text></TouchableOpacity>}
                </View>
              )}
              
              {step === 1 && (
                <>
                  {!image && <View style={styles.placeholder}><Text style={{ color: '#ccc' }}>Fotoğraf Yok</Text></View>}
                  <View style={styles.buttonRow}>
                    <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#3498db' }]} onPress={takePhoto}>
                      <Text style={styles.btnText}>📷 Kamera</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#9b59b6' }]} onPress={pickImage}>
                      <Text style={styles.btnText}>🖼️ Galeri</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={[styles.sendButton, { opacity: image ? 1 : 0.5 }]} onPress={startOCR} disabled={!image || loading}>
                    {loading ? <ActivityIndicator color="white" /> : <Text style={styles.sendButtonText}>Metni Tara 🔍</Text>}
                  </TouchableOpacity>
                </>
              )}

              {step === 2 && (
                <View style={{ width: '100%' }}>
                  {showOcrBanner && (
                    <View style={styles.ocrBanner}>
                      <Text style={styles.ocrBannerText}>⚠️ Lütfen turuncu ⍰ yerleri ve yanlış kelimeleri elle düzeltin.</Text>
                    </View>
                  )}
                  <View style={styles.ocrPreviewCard}>
                    <Text style={styles.ocrPreviewTitle}>OCR Önizleme (belirsiz yerler işaretli)</Text>
                    {/* ✅ DÜZELTME: Doğru fonksiyonu (handleOpenOcrHint) prop olarak geçiyoruz */}
                    <OcrUncertaintyText text={ocrText} onPressHint={handleOpenOcrHint} />
                  </View>
                  <TextInput
                    style={[styles.ocrInput, ocrText.includes('⍰') && { borderColor: '#d35400', borderWidth: 2, backgroundColor: '#fff7ed', color: '#d35400' }]}
                    multiline={true}
                    value={ocrText}
                    onChangeText={(t) => { setOcrText(normalizeNFC(t)); if (activeOcrHintData) setActiveOcrHintData(null); }}
                  />
                  <TouchableOpacity style={[styles.sendButton, { marginTop: 15, backgroundColor: '#27ae60' }]} onPress={startAnalysis} disabled={loading}>
                    {loading ? <ActivityIndicator color="white" /> : <Text style={styles.sendButtonText}>✅ Analiz Et ve Gönder</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={resetFlow} style={{ alignItems: 'center', marginTop: 15 }}>
                    <Text style={{ color: '#e74c3c' }}>İptal</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {step === 3 && result && (
              <View style={styles.resultContainer}>
                <View style={styles.successBox}>
                  <Text style={styles.successText}>Analiz Tamamlandı! ✅</Text>
                  <Text style={styles.successSubText}>
                    {displayErrors.length > 0 ? "Hatalar ve şüpheli yerler aşağıdadır." : "Harika! Hiç hata bulunamadı. 🎉"}
                  </Text>
                </View>
                
                <View style={styles.analysisCard}>
                  <Text style={styles.analysisTitle}>📝 Analiz Sonucu:</Text>
                  <HighlightedText text={ocrText} errors={displayErrors} onErrorPress={handleOpenPopover} />
                </View>
                
                {displayErrors.map((err, index) => (
                  <TouchableOpacity key={index} style={styles.errorItem} onPress={() => handleOpenPopover(err)}>
                    <Text style={styles.errorText}>
                      <Text style={{ textDecorationLine: 'line-through', color: err.suggestion_type==="FLAG"?'#d35400':'#e74c3c' }}>{err.wrong}</Text>
                      {' ➜ '}
                      <Text style={{ fontWeight: 'bold', color: err.suggestion_type==="FLAG"?'#e67e22':'#2ecc71' }}>{err.correct || "?"}</Text>
                    </Text>
                    <Text style={styles.errorDesc}>{err.explanation}</Text>
                    {err.suggestion_type==="FLAG" && <Text style={{fontSize:10, color:'#d35400', fontWeight:'bold', marginTop:5}}>⚠️ ŞÜPHELİ DURUM (Kontrol Et)</Text>}
                  </TouchableOpacity>
                ))}
                
                <TouchableOpacity onPress={resetFlow} style={[styles.sendButton, { backgroundColor: '#34495e', marginTop: 20 }]}>
                  <Text style={styles.sendButtonText}>Yeni Ödev Yükle</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.contentArea}>
            {loadingHistory ? (
              <ActivityIndicator size="large" color="#3498db" style={{ marginTop: 20 }} />
            ) : historyData.length === 0 ? (
              <View style={{ alignItems: 'center', marginTop: 50 }}><Text style={{ color: '#95a5a6' }}>Henüz hiç ödev göndermediniz.</Text></View>
            ) : (
              <FlatList
                data={historyData}
                keyExtractor={item => item.id.toString()}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View style={styles.historyCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <Text style={{ fontWeight: 'bold', color: '#2c3e50', fontSize: 16 }}>{new Date(item.created_at).toLocaleDateString('tr-TR')}</Text>
                      <View style={{ backgroundColor: '#ecf0f1', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                        <Text style={{ fontWeight: 'bold', color: '#7f8c8d' }}>{item.score_total ? `${item.score_total} Puan` : 'İncelendi'}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => openDetail(item)} style={{ backgroundColor: '#3498db', padding: 10, borderRadius: 8, alignItems: 'center', marginTop: 5 }}>
                      <Text style={{ color: 'white', fontWeight: 'bold' }}>Raporu İncele 👁️</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        )}
      </ScrollView>

      {/* OVERLAY */}
      {showDetailOverlay && selectedHistoryItem && (
        <View style={styles.fullScreenOverlay}>
          <View style={styles.detailContainer}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Rapor</Text>
              <TouchableOpacity onPress={() => setShowDetailOverlay(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={styles.analysisCard}>
                <HighlightedText text={selectedHistoryItem.ocr_text} errors={historyErrors} onErrorPress={(err)=>setActiveErrorData({err, x:SCREEN_WIDTH/2, y:SCREEN_HEIGHT/2})} />
              </View>
              {historyErrors.map((err, index) => (
                <TouchableOpacity key={index} style={styles.errorItem} onPress={() => handleOpenPopover(err)}>
                  <Text style={styles.errorText}>
                    <Text style={{ textDecorationLine: 'line-through', color: '#e74c3c' }}>{err.wrong}</Text>{' ➜ '}<Text style={{ fontWeight: 'bold', color: '#2ecc71' }}>{err.correct}</Text>
                  </Text>
                  <Text style={styles.errorDesc}>{err.explanation}</Text>
                </TouchableOpacity>
              ))}
              {selectedHistoryItem.analysis_json?.teacher_note && (
                <View style={styles.noteCard}>
                  <Text style={styles.noteTitle}>👨‍🏫 Öğretmeninizin Notu:</Text>
                  <Text style={styles.noteText}>{selectedHistoryItem.analysis_json.teacher_note}</Text>
                </View>
              )}
              {selectedHistoryItem.human_note && (
                <View style={[styles.noteCard, {borderLeftColor: '#3498db', backgroundColor: '#e8f4fd'}]}>
                  <Text style={[styles.noteTitle, {color: '#2980b9'}]}>Ek Not:</Text>
                  <Text style={[styles.noteText, {color: '#2980b9'}]}>{selectedHistoryItem.human_note}</Text>
                </View>
              )}
              <View style={{ height: 50 }} />
            </ScrollView>
          </View>
        </View>
      )}
      
      {activeErrorData && <ErrorPopover data={activeErrorData} onClose={() => setActiveErrorData(null)} />}
      {activeOcrHintData && <OcrHintPopover data={activeOcrHintData} onClose={() => setActiveOcrHintData(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa', paddingTop: Platform.OS === 'android' ? 40 : 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingBottom: 50 },
  
  header: { padding: 20, backgroundColor: 'white', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee' },
  name: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50' },
  badgeText: { color: '#7f8c8d', fontSize: 12, marginTop: 2 },
  logoutButton: { padding: 8, backgroundColor: '#fff0f0', borderRadius: 8 },
  logoutText: { color: '#e74c3c', fontWeight: 'bold' },

  tabsContainer: { flexDirection: 'row', margin: 20, backgroundColor: 'white', borderRadius: 10, elevation: 2 },
  tab: { flex: 1, padding: 15, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#3498db' },
  tabText: { fontWeight: '600', color: '#34495e' },

  contentArea: { paddingHorizontal: 20 },
  card: { backgroundColor: 'white', borderRadius: 15, padding: 20, marginBottom: 20, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: '#2c3e50' },

  previewContainer: { height: 250, borderRadius: 10, overflow: 'hidden', marginBottom: 15, backgroundColor: '#f0f0f0' },
  previewImage: { width: '100%', height: '100%', resizeMode: 'contain' },

  buttonRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  actionButton: { flex: 1, padding: 15, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: 'white', fontWeight: 'bold' },

  sendButton: { padding: 15, borderRadius: 10, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  sendButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  ocrBanner: { backgroundColor: '#fff7ed', padding: 10, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#fdba74' },
  ocrBannerText: { color: '#d97706', fontSize: 12, fontWeight: 'bold' },

  ocrPreviewCard: { backgroundColor: '#f8f9fa', padding: 15, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  ocrText: { fontSize: 16, lineHeight: 26, color: '#2c3e50' },
  ocrHintInline: { color: '#d97706', fontWeight: 'bold', textDecorationLine: 'underline', backgroundColor: '#fff3cd' },
  
  errorInline: { color: '#c0392b', fontWeight: 'bold', backgroundColor: '#fadbd8', textDecorationLine: 'underline', textDecorationColor: '#c0392b' },
  ocrSuspectInline: { color: '#d35400', fontWeight: 'bold', backgroundColor: '#fdebd0', textDecorationLine: 'underline', textDecorationColor: '#d35400' },

  ocrInput: { backgroundColor: 'white', borderWidth: 1, borderColor: '#ddd', padding: 15, borderRadius: 8, minHeight: 120, textAlignVertical: 'top', fontSize: 16 },

  resultContainer: { width: '100%' },
  successBox: { backgroundColor: '#d4efdf', padding: 15, borderRadius: 10, marginBottom: 15, borderWidth: 1, borderColor: '#27ae60' },
  successText: { color: '#27ae60', fontWeight: 'bold', textAlign: 'center', fontSize: 16 },
  successSubText: { textAlign: 'center', fontSize: 13, color: '#145a32', marginTop: 5 },

  analysisCard: { backgroundColor: 'white', padding: 15, borderRadius: 10, marginBottom: 15, borderWidth: 1, borderColor: '#eee' },

  errorItem: { padding: 15, backgroundColor: 'white', borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#eee', elevation: 1 },
  errorText: { fontSize: 16, marginBottom: 5, color: '#34495e' },
  errorDesc: { color: '#7f8c8d', fontSize: 13 },

  historyCard: { padding: 15, backgroundColor: 'white', borderRadius: 10, marginBottom: 10, elevation: 2 },

  fullScreenOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#f5f6fa', zIndex: 9999 },
  detailContainer: { flex: 1, paddingTop: Platform.OS === 'ios' ? 50 : 20 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, backgroundColor: 'white', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee' },
  sheetTitle: { fontSize: 18, fontWeight: 'bold' },
  
  noteCard: { backgroundColor: '#fff3cd', padding: 15, borderRadius: 10, marginTop: 20, borderLeftWidth: 5, borderLeftColor: '#f1c40f' },
  noteTitle: { fontWeight: 'bold', color: '#d35400', marginBottom: 5 },

  popoverContainer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 99999 },
  backdrop: { width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.3)' },
  popover: { position: 'absolute', width: 280, backgroundColor: 'white', padding: 20, borderRadius: 15, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 10 },
  popoverHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  popoverTitle: { fontWeight: 'bold', fontSize: 16, color: '#c0392b' },
  closeBtnText: { fontSize: 20, color: '#bdc3c7' },
  
  compareBox: { flexDirection: 'row', alignItems: 'center', marginVertical: 15, backgroundColor: '#f8f9fa', padding: 10, borderRadius: 8 },
  compareItem: { flex: 1, alignItems: 'center' },
  compareLabel: { fontSize: 10, fontWeight: 'bold', color: '#95a5a6', marginBottom: 5 },
  wrongText: { color: '#e74c3c', textDecorationLine: 'line-through', fontWeight: 'bold' },
  correctText: { color: '#27ae60', fontWeight: 'bold' },
  arrow: { marginHorizontal: 10, color: '#95a5a6', fontSize: 18 },
  
  ruleInfoBox: { marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap' },
  ruleInfoLabel: { fontWeight: 'bold', fontSize: 12, color: '#34495e', marginRight: 5 },
  ruleInfoText: { fontSize: 12, color: '#7f8c8d' },
  explanationText: { fontSize: 14, color: '#34495e', lineHeight: 20 },
});