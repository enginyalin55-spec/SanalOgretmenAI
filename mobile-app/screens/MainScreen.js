import React, { useState, useEffect } from 'react';
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
  "TDK_29_UNVANLAR": "Unvanların Yazımı",
  "TDK_30_YONLER": "Yön Adları",
  "TDK_31_ZAMAN_UYUMU": "Zaman ve Kip Uyumu"
};

// --- HIGHLIGHT BİLEŞENİ (RESPONDER + FLEX WRAP) ---
const HighlightedText = ({ text, errors, onErrorPress }) => {
  if (!text) return null;

  // Hataları sadece başlangıç noktasına göre sırala.
  // Filtreyi gevşettik: Backend ne yollarsa yollasın, biz onu "kırpıp" (clamp) göstereceğiz.
  const sortedErrors = (errors || [])
    .filter(e => e?.span?.start !== undefined)
    .sort((a, b) => a.span.start - b.span.start);

  if (sortedErrors.length === 0) {
    return <Text style={styles.normalText}>{text}</Text>;
  }

  const parts = [];
  let cursor = 0;

  sortedErrors.forEach((err, index) => {
    // Matematiksel güvenli sınırlar (Crash önleyici)
    const start = Math.max(0, err.span.start);
    const end = Math.min(text.length, err.span.end);

    // Eğer veri bozuksa veya üst üste biniyorsa atla
    if (start < cursor || start >= end) return;

    // 1. Normal Metin (Hata öncesi)
    if (start > cursor) {
      parts.push({
        type: 'text',
        key: `t-${cursor}`,
        content: text.slice(cursor, start)
      });
    }

    // 2. Hatalı Metin (View + Responder)
    parts.push({
      type: 'error',
      key: `e-${index}-${start}`,
      content: text.slice(start, end),
      errorData: err
    });

    cursor = end;
  });

  // 3. Kalan Metin
  if (cursor < text.length) {
    parts.push({
      type: 'text',
      key: `t-end`,
      content: text.slice(cursor)
    });
  }

  return (
    <View style={styles.textWrapper}>
      {parts.map((p) => {
        if (p.type === 'text') {
          return <Text key={p.key} style={styles.normalText}>{p.content}</Text>;
        }
        
        // --- İŞTE ÇÖZÜM BURASI: RESPONDER KULLANIMI ---
        return (
          <View
            key={p.key}
            // Bu iki satır dokunmayı ScrollView'den çalar ve bize verir
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => {
                console.log("TIKLANDI:", p.errorData.wrong); // Konsol kontrolü
                onErrorPress(p.errorData);
            }}
            style={styles.errorBox}
          >
            <Text style={styles.errorTextInner}>{p.content}</Text>
          </View>
        );
      })}
    </View>
  );
};

// --- KART BİLEŞENİ (ABSOLUTE OVERLAY) ---
const ErrorCardOverlay = ({ error, onClose }) => {
    if (!error) return null;
    const ruleTitle = TDK_LOOKUP[error.rule_id] || error.rule_id || "Kural İhlali";
  
    return (
      <View style={styles.overlayContainer}>
        {/* Arka plan */}
        <TouchableOpacity 
            style={styles.backdrop} 
            activeOpacity={1} 
            onPress={onClose} 
        />
        
        {/* Kart */}
        <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>⚠️ HATA DETAYI</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                    <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.compareBox}>
                <View style={styles.compareItem}>
                    <Text style={styles.compareLabel}>YANLIŞ</Text>
                    <Text style={styles.wrongText}>{error.wrong}</Text>
                </View>
                <Text style={styles.arrow}>➜</Text>
                <View style={styles.compareItem}>
                    <Text style={styles.compareLabel}>DOĞRU</Text>
                    <Text style={styles.correctText}>{error.correct}</Text>
                </View>
            </View>

            <View style={styles.ruleInfoBox}>
                <Text style={styles.ruleInfoLabel}>İHLAL EDİLEN KURAL</Text>
                <Text style={styles.ruleInfoText}>{ruleTitle}</Text>
            </View>

            <Text style={styles.explanationText}>{error.explanation}</Text>
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
  
  // KART STATE'i
  const [activeError, setActiveError] = useState(null);

  const [step, setStep] = useState(1); 
  const [image, setImage] = useState(null);
  const [imageUrl, setImageUrl] = useState(""); 
  const [loading, setLoading] = useState(false);
  const [editableText, setEditableText] = useState(""); 
  const [result, setResult] = useState(null);

  const { studentName, studentSurname, studentLevel, studentCountry, studentLanguage, classCode } = user;

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
          if(response.data.status === 'success') { setHistoryData(response.data.data); }
      } catch (error) { console.error("Geçmiş Hatası:", error); } finally { setLoadingHistory(false); }
  };

  useEffect(() => { if(activeTab === 'history') fetchHistory(); }, [activeTab]);

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert("İzin", "Kamera izni gerekli.");
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3, 4], quality: 0.7, base64: true });
    if (!res.canceled) { resetFlow(); setImage(res.assets[0]); }
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("İzin", "Galeri izni gerekli.");
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3, 4], quality: 0.7, base64: true });
    if (!res.canceled) { resetFlow(); setImage(res.assets[0]); }
  };

  const resetFlow = () => { 
      setStep(1); setImage(null); setEditableText(""); setResult(null); setImageUrl(""); setActiveError(null);
  };

  const startOCR = async () => {
    if(!image) return Alert.alert("Uyarı", "Lütfen fotoğraf seçin.");
    setLoading(true);
    try {
        const formData = new FormData();
        let localUri = image.uri;
        let filename = localUri.split('/').pop();
        if (Platform.OS === 'web' && !filename) filename = "upload.jpg";
        let match = /\.(\w+)$/.exec(filename);
        let type = match ? `image/${match[1]}` : `image/jpeg`;
        if (Platform.OS === 'web') { const res = await fetch(localUri); const blob = await res.blob(); formData.append('file', blob, filename); } 
        else { formData.append('file', { uri: localUri, name: filename, type: type }); }
        formData.append('classroom_code', classCode);
        const response = await axios.post(`${BASE_URL}/ocr`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        if (response.data.status === "success") { setEditableText(response.data.ocr_text); setImageUrl(response.data.image_url); setStep(2); }
    } catch (error) { Alert.alert("Hata", "Metin okunamadı."); } finally { setLoading(false); }
  };

  const startAnalysis = async () => {
    setLoading(true);
    try {
        const payload = { ocr_text: editableText, image_url: imageUrl, student_name: studentName, student_surname: studentSurname, classroom_code: classCode, level: studentLevel, country: studentCountry, native_language: studentLanguage };
        const response = await axios.post(`${BASE_URL}/analyze`, payload);
        if (response.data.status === "success") { setResult(response.data.data); setStep(3); }
    } catch (error) { Alert.alert("Hata", "Analiz yapılamadı."); } finally { setLoading(false); }
  };

  const openDetail = (item) => { setSelectedHistoryItem(item); setShowDetailOverlay(true); };

  // --- KART AÇMA (DOĞRUDAN STATE GÜNCELLEME) ---
  const handleOpenError = (err) => {
      // Artık setTimeout gerekmez, overlay kullanıyoruz ama güvenlik için bırakabiliriz.
      // Konsola yazalım ki tıklamanın çalıştığını görelim.
      console.log("AÇILACAK HATA:", err.wrong);
      setActiveError(err);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* HEADER */}
          <View style={styles.header}>
            <View>
                <Text style={styles.greeting}>Merhaba,</Text>
                <Text style={styles.name}>{studentName} {studentSurname}</Text>
                <View style={{flexDirection:'row', gap:5, marginTop:5}}>
                    <View style={styles.badgeContainer}><Text style={styles.badgeText}>{classCode}</Text></View>
                    <View style={[styles.badgeContainer, {backgroundColor:'#fff3cd'}]}><Text style={[styles.badgeText, {color:'#856404'}]}>{studentLevel}</Text></View>
                </View>
            </View>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}><Text style={styles.logoutText}>Çıkış</Text></TouchableOpacity>
          </View>

          {/* SEKMELER */}
          <View style={styles.tabsContainer}>
              <TouchableOpacity style={[styles.tab, activeTab === 'new' && styles.activeTab]} onPress={() => setActiveTab('new')}><Text style={[styles.tabText, activeTab === 'new' && styles.activeTabText]}>📝 Yeni Ödev</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.tab, activeTab === 'history' && styles.activeTab]} onPress={() => setActiveTab('history')}><Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>📂 Geçmişim</Text></TouchableOpacity>
          </View>

          {/* YENİ ÖDEV */}
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
                            {!image && <View style={styles.placeholder}><Text style={{color:'#ccc'}}>Fotoğraf Yok</Text></View>}
                            <View style={styles.buttonRow}>
                                <TouchableOpacity style={[styles.actionButton, {backgroundColor: '#3498db'}]} onPress={takePhoto}><Text style={styles.btnText}>📷 Kamera</Text></TouchableOpacity>
                                <TouchableOpacity style={[styles.actionButton, {backgroundColor: '#9b59b6'}]} onPress={pickImage}><Text style={styles.btnText}>🖼️ Galeri</Text></TouchableOpacity>
                            </View>
                            <TouchableOpacity style={[styles.sendButton, {opacity: image ? 1 : 0.5}]} onPress={startOCR} disabled={!image || loading}>
                                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.sendButtonText}>Metni Tara 🔍</Text>}
                            </TouchableOpacity>
                        </>
                    )}
                    {step === 2 && (
                        <View style={{width:'100%'}}>
                            <TextInput style={styles.ocrInput} multiline={true} value={editableText} onChangeText={setEditableText} />
                            <TouchableOpacity style={[styles.sendButton, {marginTop:15, backgroundColor:'#27ae60'}]} onPress={startAnalysis} disabled={loading}>
                                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.sendButtonText}>✅ Analiz Et</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={resetFlow} style={{alignItems:'center', marginTop:15}}><Text style={{color:'#e74c3c'}}>İptal</Text></TouchableOpacity>
                        </View>
                    )}
                </View>

                {step === 3 && result && (
                    <View style={styles.resultContainer}>
                        <View style={styles.successBox}>
                             <Text style={styles.successText}>Ödevin Başarıyla Gönderildi! ✅</Text>
                             <Text style={styles.successSubText}>Hatalı kelimelerin üzerine dokunarak detayları görebilirsin.</Text>
                        </View>
                        
                        <View style={styles.analysisCard}>
                             <Text style={styles.analysisTitle}>📝 Analiz Sonucu:</Text>
                             <HighlightedText 
                                text={editableText} 
                                errors={result.errors} 
                                onErrorPress={handleOpenError} 
                             />
                        </View>

                        {/* LISTE */}
                        {result.errors && result.errors.map((err, index) => (
                            <TouchableOpacity key={index} style={styles.errorItem} onPress={() => handleOpenError(err)}>
                                <Text style={styles.errorText}>
                                    <Text style={{textDecorationLine:'line-through', color:'#e74c3c'}}>{err.wrong}</Text> 
                                    {' ➜ '} 
                                    <Text style={{fontWeight:'bold', color:'#2ecc71'}}>{err.correct}</Text>
                                </Text>
                                <Text style={styles.errorDesc}>{err.explanation}</Text>
                                <Text style={{fontSize:10, color:'#3498db', marginTop:5, textAlign:'right'}}>Detay 👉</Text>
                            </TouchableOpacity>
                        ))}
                        
                        <TouchableOpacity onPress={resetFlow} style={[styles.sendButton, {backgroundColor:'#34495e', marginTop:20}]}><Text style={styles.sendButtonText}>Yeni Ödev Yükle</Text></TouchableOpacity>
                    </View>
                )}
             </View>
          )}

          {/* GEÇMİŞ */}
          {activeTab === 'history' && (
             <View style={styles.contentArea}>
                 {loadingHistory ? (
                     <ActivityIndicator size="large" color="#3498db" style={{marginTop:20}} />
                 ) : historyData.length === 0 ? (
                     <View style={{alignItems:'center', marginTop:50}}><Text style={{color:'#95a5a6'}}>Geçmiş yok.</Text></View>
                 ) : (
                     <FlatList 
                        data={historyData}
                        keyExtractor={item => item.id.toString()}
                        scrollEnabled={false} 
                        renderItem={({item}) => (
                            <View style={styles.historyCard}>
                                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                                    <Text style={{fontWeight:'bold', color:'#2c3e50', fontSize:16}}>
                                        {new Date(item.created_at).toLocaleDateString('tr-TR')}
                                    </Text>
                                    <View style={{backgroundColor: '#ecf0f1', paddingHorizontal:10, paddingVertical:4, borderRadius:12}}>
                                        <Text style={{fontWeight:'bold', color: '#7f8c8d'}}>{item.score_total ? `${item.score_total} Puan` : 'İncelendi'}</Text>
                                    </View>
                                </View>
                                <TouchableOpacity onPress={() => openDetail(item)} style={{backgroundColor:'#3498db', padding:10, borderRadius:8, alignItems:'center', marginTop:5}}>
                                    <Text style={{color:'white', fontWeight:'bold'}}>Raporu İncele 👁️</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                     />
                 )}
             </View>
          )}
      </ScrollView>

      {/* --- ABSOLUTE OVERLAYS (EN ÜST KATMAN) --- */}
      
      {/* 1. HATA KARTI OVERLAY */}
      {activeError && <ErrorCardOverlay error={activeError} onClose={() => setActiveError(null)} />}

      {/* 2. DETAY OVERLAY (GEÇMİŞ İÇİN) */}
      {showDetailOverlay && selectedHistoryItem && (
          <View style={styles.fullScreenOverlay}>
             <View style={styles.detailContainer}>
                 <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>Ödev Raporu</Text>
                    <TouchableOpacity onPress={() => setShowDetailOverlay(false)} style={styles.closeBtn}>
                        <Text style={styles.closeBtnText}>✕</Text>
                    </TouchableOpacity>
                 </View>
                 <ScrollView contentContainerStyle={{padding:20}}>
                     <View style={styles.analysisCard}>
                        <HighlightedText 
                            text={selectedHistoryItem.ocr_text} 
                            errors={selectedHistoryItem.analysis_json?.errors} 
                            onErrorPress={handleOpenError} 
                        />
                     </View>
                     {selectedHistoryItem.human_note && (
                        <View style={styles.noteCard}>
                            <Text style={styles.noteTitle}>👨‍🏫 Öğretmeninizin Notu:</Text>
                            <Text style={styles.noteText}>{selectedHistoryItem.human_note}</Text>
                        </View>
                     )}
                     <View style={{height:50}}></View>
                 </ScrollView>
             </View>
          </View>
      )}
    
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa', paddingTop: Platform.OS === 'android' ? 40 : 0 },
  scrollContent: { paddingBottom: 50 }, 
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, backgroundColor: 'white', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, marginBottom:15, ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.05)' }, default: { elevation: 3 } }) },
  greeting: { fontSize: 14, color: '#7f8c8d' },
  name: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50' },
  badgeContainer: { backgroundColor: '#e8f0fe', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, alignSelf: 'flex-start' },
  badgeText: { color: '#3498db', fontWeight: 'bold', fontSize: 12 },
  logoutButton: { backgroundColor: '#fff0f0', padding: 10, borderRadius: 10 },
  logoutText: { color: '#e74c3c', fontWeight: 'bold', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor:'white', marginHorizontal:20, borderRadius:12, overflow:'hidden', marginBottom:15, ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.05)' }, default: { elevation: 2 } }) },
  tab: { flex: 1, paddingVertical: 15, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#3498db', backgroundColor:'#fcfcfc' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#95a5a6' },
  activeTabText: { color: '#3498db' },
  contentArea: { paddingHorizontal: 20 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 20, alignItems: 'center', marginBottom: 20, ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.05)' }, default: { elevation: 3 } }) },
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
  ocrInput: { backgroundColor: '#fff', padding: 15, borderRadius: 10, fontSize: 16, color: '#2c3e50', borderWidth: 2, borderColor: '#3498db', minHeight: 150, textAlignVertical: 'top', width:'100%' },
  historyCard: { backgroundColor:'white', padding:15, borderRadius:12, marginBottom:15, ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.03)' }, default: { elevation: 2 } }) },
  
  resultContainer: { width: '100%', paddingBottom: 30 },
  successBox: { backgroundColor:'#e8f8f5', padding:15, borderRadius:12, marginBottom:15, borderWidth:1, borderColor:'#2ecc71' },
  successText: { color:'#27ae60', fontWeight:'bold', fontSize:16, textAlign:'center' },
  successSubText: { textAlign:'center', color:'#555', marginTop:5, fontSize:13 },
  analysisCard: { backgroundColor:'white', padding:20, borderRadius:12, marginBottom:20, borderWidth:1, borderColor:'#eee' },
  analysisTitle: { fontWeight:'bold', color:'#34495e', marginBottom:10, fontSize:14 },
  textWrapper: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  normalText: { fontSize: 16, lineHeight: 28, color: '#2c3e50' },
  errorBox: { backgroundColor: '#fff0f0', borderRadius: 4, paddingHorizontal: 4, marginHorizontal: 2, borderBottomWidth: 2, borderBottomColor: '#e74c3c', marginBottom: 4 },
  errorTextInner: { fontSize: 16, lineHeight: 24, color: '#c0392b', fontWeight: 'bold' },
  errorItem: { backgroundColor:'white', padding:15, borderRadius:10, marginBottom:10, borderBottomWidth:1, borderBottomColor:'#f0f0f0' },
  errorText: { fontSize: 16, marginBottom: 5 },
  errorDesc: { fontSize: 13, color: '#7f8c8d' },
  noteCard: { backgroundColor: '#fff3cd', padding: 20, borderRadius: 15, marginBottom: 15, borderLeftWidth: 5, borderLeftColor: '#ffc107' },
  noteTitle: { fontWeight: 'bold', color: '#856404', marginBottom: 5 },
  noteText: { color: '#856404', fontSize: 14, lineHeight: 20 },

  // --- OVERLAY STYLES (EN KRİTİK KISIM) ---
  overlayContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, elevation: 9999, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 25, minHeight: 300, width: '100%', paddingBottom: 50 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', color: '#e74c3c' },
  closeBtn: { padding: 10, backgroundColor: '#f1f2f6', borderRadius: 20 },
  closeBtnText: { fontSize: 18, color: '#95a5a6', fontWeight: 'bold' },
  compareBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25, backgroundColor: '#f9f9f9', padding: 15, borderRadius: 12 },
  compareItem: { flex: 1, alignItems: 'center' },
  compareLabel: { fontSize: 12, color: '#e74c3c', fontWeight: 'bold', marginBottom: 5 },
  wrongText: { color: '#c0392b', fontWeight: 'bold', textDecorationLine: 'line-through', fontSize: 18 },
  correctText: { color: '#27ae60', fontWeight: 'bold', fontSize: 18 },
  arrow: { fontSize: 24, color: '#bdc3c7', marginHorizontal: 10 },
  ruleInfoBox: { backgroundColor: '#e8f4fd', padding: 12, borderRadius: 8, borderLeftWidth: 5, borderLeftColor: '#3498db', marginBottom: 20 },
  ruleInfoLabel: { fontSize: 11, color: '#3498db', fontWeight: 'bold' },
  ruleInfoText: { fontSize: 15, fontWeight: 'bold', color: '#2c3e50', marginTop: 4 },
  explanationText: { fontSize: 15, color: '#34495e', lineHeight: 22 },

  // FULL SCREEN OVERLAY (GEÇMİŞ İÇİN)
  fullScreenOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9000, backgroundColor: '#f5f6fa' },
  detailContainer: { flex: 1, paddingTop: 40 }
});