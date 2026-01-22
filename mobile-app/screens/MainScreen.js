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

const OcrUncertaintyText = ({ text, onPressHint }) => {
  const spans = useMemo(() => buildOcrUncertaintySpans(text), [text]);

  if (!text) return null;
  if (!spans || spans.length === 0) {
    return <Text style={styles.ocrText}>{text}</Text>;
  }

  const parts = [];
  let cursor = 0;

  spans.forEach((sp, idx) => {
    const start = Math.max(0, sp.start);
    const end = Math.min(text.length, sp.end);
    if (start >= end || start < cursor) return;

    if (start > cursor) {
      parts.push({ type: "text", key: `t-${cursor}`, content: text.slice(cursor, start) });
    }

    parts.push({
      type: "hint",
      key: `h-${idx}`,
      content: text.slice(start, end),
      span: sp
    });

    cursor = end;
  });

  if (cursor < text.length) {
    parts.push({ type: "text", key: `t-end`, content: text.slice(cursor) });
  }

  return (
    <Text style={styles.ocrText}>
      {parts.map((p) => {
        if (p.type === "text") {
          return <Text key={p.key} style={styles.ocrText}>{p.content}</Text>;
        }
        return (
          <Text
            key={p.key}
            style={styles.ocrHintInline}
            onPress={() => onPressHint?.(p.span, { x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 })}
            suppressHighlighting={true}
          >
            {p.content}
          </Text>
        );
      })}
    </Text>
  );
};

// ✅ GÜNCELLENMİŞ HighlightedText (Renk Ayrımı Var)
const HighlightedText = ({ text, errors, onErrorPress }) => {
  if (!text) return null;

  // Hata listesi boşsa düz metin dön
  const safeErrors = (errors || [])
    .filter(e => e?.span?.start !== undefined)
    .sort((a, b) => a.span.start - b.span.start);

  if (safeErrors.length === 0) {
    return <Text style={styles.ocrText}>{text}</Text>;
  }

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

    // ✅ RENK SEÇİMİ: SUSPECT veya FLAG ise turuncu, değilse kırmızı
    const isSuspect = err.severity === "SUSPECT" || err.suggestion_type === "FLAG";
    
    parts.push({ 
      type: "error", 
      key: `e-${index}`, 
      content: text.slice(start, end), 
      errorData: err,
      isSuspect // Stile prop olarak geçeceğiz
    });
    cursor = end;
  });

  if (cursor < text.length) {
    parts.push({ type: "text", key: "t-end", content: text.slice(cursor) });
  }

  return (
    <Text style={styles.ocrText}>
      {parts.map((p) => {
        if (p.type === "text") {
          return <Text key={p.key} style={styles.ocrText}>{p.content}</Text>;
        }
        return (
          <Text
            key={p.key}
            // Şüpheli ise turuncu stil, kesin hata ise kırmızı stil
            style={p.isSuspect ? styles.ocrSuspectInline : styles.errorInline}
            onPress={() => onErrorPress?.(p.errorData, { x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 })}
            suppressHighlighting={true}
          >
            {p.content}
          </Text>
        );
      })}
    </Text>
  );
};

const ErrorPopover = ({ data, onClose }) => {
  if (!data?.err) return null;
  const { err, x, y } = data;
  const ruleTitle = TDK_LOOKUP[err.rule_id] || err.rule_id || "Kural İhlali";
  let left = x - 150;
  let top = y + 35;
  if (left < 10) left = 10;
  if (left + 300 > SCREEN_WIDTH) left = SCREEN_WIDTH - 310;
  if (top + 250 > SCREEN_HEIGHT) top = y - 260;

  return (
    <View style={styles.popoverContainer}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.popover, { left, top }]}>
        <View style={styles.popoverHeader}>
          <Text style={styles.popoverTitle}>⚠️ DETAY</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 5 }}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
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
  let left = x - 150;
  let top = y + 35;
  if (left < 10) left = 10;
  if (left + 300 > SCREEN_WIDTH) left = SCREEN_WIDTH - 310;
  if (top + 180 > SCREEN_HEIGHT) top = y - 190;

  return (
    <View style={styles.popoverContainer}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.popover, { left, top }]}>
        <View style={styles.popoverHeader}>
          <Text style={[styles.popoverTitle, { color: '#d97706' }]}>ℹ️ OKUNAMADI</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 5 }}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 13, color: '#34495e', lineHeight: 18 }}>
          Yapay zeka burayı net okuyamadı. Lütfen elle düzeltin.
        </Text>
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

  if (!user) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#3498db" />
        <Text style={{ marginTop: 10, color: '#7f8c8d' }}>Yükleniyor...</Text>
      </View>
    );
  }

  const { studentName, studentSurname, studentLevel, classCode } = user;

  const handleLogout = async () => {
    try { await AsyncStorage.clear(); setUser(null); } catch (error) { console.log(error); }
  };

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const formData = new FormData();
      formData.append('student_name', studentName);
      formData.append('student_surname', studentSurname);
      formData.append('classroom_code', classCode);
      const response = await axios.post(`${BASE_URL}/student-history`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (response.data.status === 'success') { setHistoryData(response.data.data); }
    } catch (error) {
      console.error("Geçmiş Hatası:", error);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => { if (activeTab === 'history') fetchHistory(); }, [activeTab]);

  const resetFlow = () => {
    setStep(1); setImage(null); setOcrText(""); setResult(null); setImageUrl(""); setActiveErrorData(null); setActiveOcrHintData(null);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return showAlert("İzin", "Kamera izni gerekli.");
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3, 4], quality: 0.7, base64: true
    });
    if (!res.canceled) { resetFlow(); setImage(res.assets[0]); }
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return showAlert("İzin", "Galeri izni gerekli.");
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3, 4], quality: 0.7, base64: true
    });
    if (!res.canceled) { resetFlow(); setImage(res.assets[0]); }
  };

  const startOCR = async () => {
    if (!image) return showAlert("Uyarı", "Lütfen fotoğraf seçin.");
    setLoading(true);
    try {
      const formData = new FormData();
      let localUri = image.uri;
      let filename = localUri.split('/').pop();
      if (Platform.OS === 'web' && !filename) filename = "upload.jpg";
      
      if (Platform.OS === 'web') {
        const res = await fetch(localUri);
        const blob = await res.blob();
        formData.append('file', blob, filename);
      } else {
        formData.append('file', { uri: localUri, name: filename, type: 'image/jpeg' });
      }
      formData.append('classroom_code', classCode);

      const response = await axios.post(`${BASE_URL}/ocr`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (response.data.status === "success") {
        setOcrText(normalizeNFC(response.data.ocr_text || ""));
        setImageUrl(response.data.image_url || "");
        setStep(2);
      }
    } catch (error) {
      showAlert("Hata", "Metin okunamadı.");
    } finally {
      setLoading(false);
    }
  };

  const startAnalysis = async () => {
    if (!ocrText || ocrText.trim() === "") return showAlert("Hata", "Metin boş.");
    if (hasOcrUncertainty(ocrText)) return showAlert("Düzeltme Gerekli", "Lütfen turuncu ⍰ işaretli yerleri düzeltin.");

    setLoading(true);
    try {
      const payload = {
        ocr_text: ocrText, image_url: imageUrl,
        student_name: studentName, student_surname: studentSurname,
        classroom_code: classCode, level: studentLevel,
        country: user.studentCountry, native_language: user.studentLanguage
      };

      const response = await axios.post(`${BASE_URL}/analyze`, payload);

      if (response.data.status === "success") {
        setResult(response.data.data);
        setStep(3);
      }
    } catch (error) {
      showAlert("Hata", "Analiz yapılamadı.");
    } finally {
      setLoading(false);
    }
  };

  const showOcrBanner = (step === 2);

  // ✅ HATA LİSTESİ BİRLEŞTİRME (GPT FIX)
  const getCombinedErrors = (res) => {
    if (!res) return [];
    // Student ve OCR listelerini birleştir
    const list1 = res.errors_student || [];
    const list2 = res.errors_ocr || [];
    // Eski versiyon uyumluluğu için "errors" da bak
    const list3 = res.errors || [];
    // Hepsini birleştir
    const all = [...list1, ...list2, ...list3];
    // Span başlangıcına göre sırala
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
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}><Text style={styles.logoutText}>Çıkış</Text></TouchableOpacity>
        </View>

        <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'new' && styles.activeTab]} onPress={() => setActiveTab('new')}>
            <Text style={[styles.tabText, activeTab === 'new' && styles.activeTabText]}>📝 Yeni Ödev</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'history' && styles.activeTab]} onPress={() => setActiveTab('history')}>
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>📂 Geçmişim</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'new' && (
          <View style={styles.contentArea}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{step === 1 ? "1. Fotoğraf Yükle" : step === 2 ? "2. Metni Kontrol Et" : "3. Sonuçlar"}</Text>

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
                    <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#3498db' }]} onPress={takePhoto}><Text style={styles.btnText}>📷 Kamera</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#9b59b6' }]} onPress={pickImage}><Text style={styles.btnText}>🖼️ Galeri</Text></TouchableOpacity>
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
                  <TouchableOpacity onPress={resetFlow} style={{ alignItems: 'center', marginTop: 15 }}><Text style={{ color: '#e74c3c' }}>İptal</Text></TouchableOpacity>
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
                  {/* ✅ DÜZELTME: Birleştirilmiş listeyi gönderiyoruz */}
                  <HighlightedText text={ocrText} errors={displayErrors} onErrorPress={handleOpenPopover} />
                </View>
                {/* ✅ LİSTELEME: Birleştirilmiş listeyi dönüyoruz */}
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

      {showDetailOverlay && selectedHistoryItem && (
        <View style={styles.fullScreenOverlay}>
          <View style={styles.detailContainer}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Ödev Raporu</Text>
              <TouchableOpacity onPress={() => setShowDetailOverlay(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={styles.analysisCard}>
                {/* ✅ GEÇMİŞ İÇİN DE AYNI DÜZELTME */}
                <HighlightedText text={selectedHistoryItem.ocr_text} errors={historyErrors} onErrorPress={handleOpenPopover} />
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
  scrollContent: { paddingBottom: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, backgroundColor: 'white', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, marginBottom: 15, elevation: 3 },
  greeting: { fontSize: 14, color: '#7f8c8d' },
  name: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50' },
  badgeContainer: { backgroundColor: '#e8f0fe', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, alignSelf: 'flex-start' },
  badgeText: { color: '#3498db', fontWeight: 'bold', fontSize: 12 },
  logoutButton: { backgroundColor: '#fff0f0', padding: 10, borderRadius: 10 },
  logoutText: { color: '#e74c3c', fontWeight: 'bold', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor: 'white', marginHorizontal: 20, borderRadius: 12, overflow: 'hidden', marginBottom: 15, elevation: 2 },
  tab: { flex: 1, paddingVertical: 15, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#3498db', backgroundColor: '#fcfcfc' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#95a5a6' },
  activeTabText: { color: '#3498db' },
  contentArea: { paddingHorizontal: 20 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 20, alignItems: 'center', marginBottom: 20, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#34495e', marginBottom: 15 },
  placeholder: { width: '100%', height: 200, backgroundColor: '#f1f2f6', borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#e1e1e1', borderStyle: 'dashed' },
  previewContainer: { width: '100%', height: 250, marginBottom: 20, borderRadius: 15, overflow: 'hidden', position: 'relative' },
  previewImage: { width: '100%', height: '100%', resizeMode: 'contain' },
  removeButton: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  removeButtonText: { color: 'white', fontWeight: 'bold' },
  buttonRow: { flexDirection: 'row', gap: 15, width: '100%', marginBottom: 15 },
  actionButton: { flex: 1, padding: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  sendButton: { backgroundColor: '#2ecc71', width: '100%', padding: 18, borderRadius: 12, alignItems: 'center' },
  sendButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  ocrBanner: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fdba74', padding: 12, borderRadius: 10, marginBottom: 12 },
  ocrBannerText: { color: '#92400e', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  ocrPreviewCard: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12 },
  ocrPreviewTitle: { fontWeight: 'bold', color: '#6b7280', marginBottom: 8, fontSize: 12 },
  ocrText: { fontSize: 16, lineHeight: 28, color: '#2c3e50' },
  ocrHintInline: { color: '#d97706', fontWeight: '700', textDecorationLine: 'underline', textDecorationColor: '#f59e0b' },
  
  // ✅ YENİ STİLLER (RENK AYRIMI)
  errorInline: { color: '#c0392b', fontWeight: 'bold', backgroundColor: '#fff0f0', textDecorationLine: 'underline', textDecorationColor: '#e74c3c' },
  ocrSuspectInline: { color: '#d35400', fontWeight: 'bold', backgroundColor: '#fff7ed', textDecorationLine: 'underline', textDecorationColor: '#f39c12' },

  ocrInput: { backgroundColor: '#fff', padding: 15, borderRadius: 10, fontSize: 16, color: '#2c3e50', borderWidth: 2, borderColor: '#3498db', minHeight: 150, textAlignVertical: 'top', width: '100%' },
  historyCard: { backgroundColor: 'white', padding: 15, borderRadius: 12, marginBottom: 15, elevation: 2 },
  resultContainer: { width: '100%', paddingBottom: 30 },
  successBox: { backgroundColor: '#e8f8f5', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#2ecc71' },
  successText: { color: '#27ae60', fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
  successSubText: { textAlign: 'center', color: '#555', marginTop: 5, fontSize: 13 },
  analysisCard: { backgroundColor: 'white', padding: 20, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: '#eee' },
  analysisTitle: { fontWeight: 'bold', color: '#34495e', marginBottom: 10, fontSize: 14 },
  errorItem: { backgroundColor: 'white', padding: 15, borderRadius: 10, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  errorText: { fontSize: 16, marginBottom: 5 },
  errorDesc: { fontSize: 13, color: '#7f8c8d' },
  noteCard: { backgroundColor: '#fff3cd', padding: 20, borderRadius: 15, marginBottom: 15, borderLeftWidth: 5, borderLeftColor: '#ffc107' },
  noteTitle: { fontWeight: 'bold', color: '#856404', marginBottom: 5 },
  noteText: { color: '#856404', fontSize: 14, lineHeight: 20 },
  popoverContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, elevation: 9999 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  popover: { position: 'absolute', width: 300, backgroundColor: 'white', borderRadius: 12, padding: 15, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 },
  popoverHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  popoverTitle: { fontSize: 14, fontWeight: 'bold', color: '#e74c3c' },
  closeBtnText: { fontSize: 18, color: '#95a5a6', fontWeight: 'bold' },
  compareBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8 },
  compareItem: { flex: 1, alignItems: 'center' },
  compareLabel: { fontSize: 10, color: '#e74c3c', fontWeight: 'bold', marginBottom: 2 },
  wrongText: { color: '#c0392b', fontWeight: 'bold', textDecorationLine: 'line-through', fontSize: 14 },
  correctText: { color: '#27ae60', fontWeight: 'bold', fontSize: 14 },
  arrow: { fontSize: 18, color: '#bdc3c7', marginHorizontal: 5 },
  ruleInfoBox: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, backgroundColor: '#e8f4fd', padding: 8, borderRadius: 6, borderLeftWidth: 3, borderLeftColor: '#3498db' },
  ruleInfoLabel: { fontSize: 10, color: '#3498db', fontWeight: 'bold', marginRight: 5 },
  ruleInfoText: { fontSize: 12, fontWeight: 'bold', color: '#2c3e50' },
  explanationText: { fontSize: 13, color: '#34495e', lineHeight: 18 },
  fullScreenOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9000, backgroundColor: '#f5f6fa' },
  detailContainer: { flex: 1, paddingTop: 40, paddingBottom: 20 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 },
  sheetTitle: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50' },
  closeBtn: { padding: 10, backgroundColor: '#f1f2f6', borderRadius: 20 },
});