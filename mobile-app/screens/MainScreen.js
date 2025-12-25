import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, Image, Alert, ScrollView, Platform, ActivityIndicator, TextInput, FlatList, Modal 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios'; 

// --- SUNUCU ADRESİ ---
const BASE_URL = 'https://sanalogretmenai.onrender.com'; 

// --- HIGHLIGHTED TEXT BİLEŞENİ ---
const HighlightedText = ({ text, errors }) => {
  if (!text) return null;
  if (!errors || errors.length === 0) return <Text style={{fontSize:16, lineHeight:24, color:'#2c3e50'}}>{text}</Text>;

  let ranges = [];
  const lowerText = text.toLowerCase(); 

  errors.forEach(err => {
    if (!err.wrong) return;
    const searchStr = err.wrong.toLowerCase().trim();
    if (searchStr.length < 2) return; 

    let pos = lowerText.indexOf(searchStr);
    while (pos !== -1) {
        ranges.push({ start: pos, end: pos + searchStr.length, error: err });
        pos = lowerText.indexOf(searchStr, pos + 1);
    }
  });

  ranges.sort((a, b) => a.start - b.start);

  let uniqueRanges = [];
  let lastEnd = -1;
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
        elements.push(
            <Text key={`text-${i}`}>{text.substring(currentIndex, range.start)}</Text>
        );
    }
    elements.push(
        <Text 
            key={`err-${i}`}
            onPress={() => Alert.alert(
                "❌ Hata Detayı", 
                `Yanlış: ${range.error.wrong}\n✅ Doğrusu: ${range.error.correct}\n\n💡 Açıklama: ${range.error.explanation}`
            )}
            style={{ 
                color: '#e74c3c', 
                fontWeight: 'bold', 
                textDecorationLine: 'underline',
                backgroundColor: '#fff0f0' 
            }}
        >
            {text.substring(range.start, range.end)}
        </Text>
    );
    currentIndex = range.end;
  });

  if (currentIndex < text.length) {
      elements.push(<Text key="text-end">{text.substring(currentIndex)}</Text>);
  }

  return <Text style={{ fontSize: 16, lineHeight: 28, color: '#2c3e50' }}>{elements}</Text>;
};

export default function MainScreen({ user, setUser }) {
  const [activeTab, setActiveTab] = useState('new'); 
  const [historyData, setHistoryData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null); 
  const [showDetailModal, setShowDetailModal] = useState(false);

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

  // --- DÜZELTİLEN KISIM ---
  const resetFlow = () => { 
      setStep(1); 
      setImage(null); // <--- BU SATIR EKSİKTİ, ARTIK RESİM SİLİNECEK
      setEditableText(""); 
      setResult(null); 
      setImageUrl(""); 
  };
  // ------------------------

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

  const openDetail = (item) => { setSelectedHistoryItem(item); setShowDetailModal(true); };

  return (
    <View style={styles.container}>
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

      <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'new' && styles.activeTab]} onPress={() => setActiveTab('new')}><Text style={[styles.tabText, activeTab === 'new' && styles.activeTabText]}>📝 Yeni Ödev</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'history' && styles.activeTab]} onPress={() => setActiveTab('history')}><Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>📂 Geçmişim</Text></TouchableOpacity>
      </View>

      <View style={{flex:1}}>
          {/* YENİ ÖDEV EKRANI */}
          {activeTab === 'new' && (
             <ScrollView contentContainerStyle={styles.content}>
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
                            <Text style={{fontSize:13, color:'#7f8c8d', marginBottom:5}}>Metni düzenleyebilirsiniz:</Text>
                            <TextInput style={styles.ocrInput} multiline={true} value={editableText} onChangeText={setEditableText} />
                            <TouchableOpacity style={[styles.sendButton, {marginTop:15, backgroundColor:'#27ae60'}]} onPress={startAnalysis} disabled={loading}>
                                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.sendButtonText}>✅ Analiz Et ve Gönder</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={resetFlow} style={{alignItems:'center', marginTop:15}}><Text style={{color:'#e74c3c'}}>İptal</Text></TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* --- CANLI SONUÇ EKRANI (STEP 3) --- */}
                {step === 3 && result && (
                    <View style={styles.resultContainer}>
                        <View style={{backgroundColor:'#e8f8f5', padding:15, borderRadius:12, marginBottom:15, borderWidth:1, borderColor:'#2ecc71'}}>
                             <Text style={{color:'#27ae60', fontWeight:'bold', fontSize:16, textAlign:'center'}}>Ödevin Başarıyla Gönderildi! ✅</Text>
                             <Text style={{textAlign:'center', color:'#555', marginTop:5, fontSize:13}}>Hataların aşağıda listelenmiştir. Notun öğretmen kontrolünden sonra açıklanacaktır.</Text>
                        </View>
                        
                        <View style={{backgroundColor:'white', padding:20, borderRadius:12, marginBottom:20, borderWidth:1, borderColor:'#eee'}}>
                             <Text style={{fontWeight:'bold', color:'#34495e', marginBottom:10, fontSize:14}}>📝 Analiz Sonucu:</Text>
                             <HighlightedText text={editableText} errors={result.errors} />
                        </View>
                        
                        {result.errors && result.errors.map((err, index) => (
                            <View key={index} style={styles.errorItem}>
                                <Text style={styles.errorText}>
                                    <Text style={{textDecorationLine:'line-through', color:'#e74c3c'}}>{err.wrong}</Text> 
                                    {' ➜ '} 
                                    <Text style={{fontWeight:'bold', color:'#2ecc71'}}>{err.correct}</Text>
                                </Text>
                                <Text style={styles.errorDesc}>{err.explanation}</Text>
                            </View>
                        ))}
                        
                        <TouchableOpacity onPress={resetFlow} style={[styles.sendButton, {backgroundColor:'#34495e', marginTop:20}]}><Text style={styles.sendButtonText}>Yeni Ödev Yükle</Text></TouchableOpacity>
                    </View>
                )}
             </ScrollView>
          )}

          {/* GEÇMİŞ EKRANI */}
          {activeTab === 'history' && (
             <View style={{flex:1, padding:20}}>
                 {loadingHistory ? (
                     <ActivityIndicator size="large" color="#3498db" style={{marginTop:20}} />
                 ) : historyData.length === 0 ? (
                     <View style={{alignItems:'center', marginTop:50}}><Text style={{color:'#95a5a6'}}>Henüz hiç ödev göndermediniz.</Text></View>
                 ) : (
                     <FlatList 
                        data={historyData}
                        keyExtractor={item => item.id.toString()}
                        renderItem={({item}) => (
                            <View style={styles.historyCard}>
                                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                                    <Text style={{fontWeight:'bold', color:'#2c3e50', fontSize:16}}>
                                        {new Date(item.created_at).toLocaleDateString('tr-TR')}
                                    </Text>
                                    <View style={{backgroundColor: '#ecf0f1', paddingHorizontal:10, paddingVertical:4, borderRadius:12}}>
                                        <Text style={{fontWeight:'bold', color: '#7f8c8d'}}>
                                            İncelendi
                                        </Text>
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
      </View>

      <Modal visible={showDetailModal} animationType="slide" presentationStyle="pageSheet">
          <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Ödev Raporu</Text>
                  <TouchableOpacity onPress={() => setShowDetailModal(false)} style={styles.closeButton}>
                      <Text style={{color:'white', fontWeight:'bold'}}>Kapat</Text>
                  </TouchableOpacity>
              </View>
              {selectedHistoryItem && (
                  <ScrollView contentContainerStyle={{padding:20}}>
                      <View style={{backgroundColor:'#e8f8f5', padding:15, borderRadius:12, marginBottom:15, borderWidth:1, borderColor:'#2ecc71', alignItems:'center'}}>
                            <Text style={{color:'#27ae60', fontWeight:'bold'}}>Öğretmen Değerlendirmesi Bekleniyor</Text>
                      </View>
                      <View style={{backgroundColor:'white', padding:20, borderRadius:12, marginBottom:20, borderWidth:1, borderColor:'#eee'}}>
                          <Text style={{fontWeight:'bold', color:'#34495e', marginBottom:10, fontSize:14}}>📝 Yazınız :</Text>
                          <HighlightedText 
                              text={selectedHistoryItem.ocr_text} 
                              errors={selectedHistoryItem.analysis_json?.errors} 
                          />
                      </View>
                      {selectedHistoryItem.analysis_json?.errors?.length > 0 ? (
                          <View style={styles.errorsCard}>
                            <Text style={styles.errorTitle}>⚠️ Hata Özeti:</Text>
                            {selectedHistoryItem.analysis_json.errors.map((err, index) => (
                                <View key={index} style={styles.errorItem}>
                                    <Text style={styles.errorText}>
                                        <Text style={{textDecorationLine:'line-through', color:'#e74c3c'}}>{err.wrong}</Text> 
                                        {' ➜ '} 
                                        <Text style={{fontWeight:'bold', color:'#2ecc71'}}>{err.correct}</Text>
                                    </Text>
                                    <Text style={styles.errorDesc}>{err.explanation}</Text>
                                </View>
                            ))}
                          </View>
                      ) : (
                          <View style={{padding:20, alignItems:'center'}}><Text style={{color:'#27ae60', fontWeight:'bold'}}>Harika! Hiç hata bulunamadı. 🎉</Text></View>
                      )}
                      {selectedHistoryItem.human_note ? (
                        <View style={[styles.noteCard, {backgroundColor:'#fef9e7', borderLeftColor:'#d35400', marginBottom:20}]}>
                            <Text style={[styles.noteTitle, {color:'#d35400'}]}>👨‍🏫 Öğretmeninizin Notu:</Text>
                            <Text style={[styles.noteText, {color:'#d35400'}]}>{selectedHistoryItem.human_note}</Text>
                        </View>
                      ) : (
                          <View style={{marginBottom:10}}><Text style={{fontStyle:'italic', color:'#95a5a6', textAlign:'center'}}>Öğretmeniniz henüz not eklemedi.</Text></View>
                      )}
                      <View style={{height:50}}></View>
                  </ScrollView>
              )}
          </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa', paddingTop: Platform.OS === 'android' ? 40 : 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, backgroundColor: 'white', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.05)' }, default: { elevation: 3 } }) },
  greeting: { fontSize: 14, color: '#7f8c8d' },
  name: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50' },
  badgeContainer: { backgroundColor: '#e8f0fe', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, alignSelf: 'flex-start' },
  badgeText: { color: '#3498db', fontWeight: 'bold', fontSize: 12 },
  logoutButton: { backgroundColor: '#fff0f0', padding: 10, borderRadius: 10 },
  logoutText: { color: '#e74c3c', fontWeight: 'bold', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor:'white', marginTop:15, marginHorizontal:20, borderRadius:12, overflow:'hidden', ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.05)' }, default: { elevation: 2 } }) },
  tab: { flex: 1, paddingVertical: 15, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#3498db', backgroundColor:'#fcfcfc' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#95a5a6' },
  activeTabText: { color: '#3498db' },
  content: { padding: 20 },
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
  scoreCard: { backgroundColor: 'white', padding: 20, borderRadius: 15, alignItems: 'center', marginBottom: 15, ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.05)' }, default: { elevation: 3 } }) },
  scoreTitle: { fontSize: 14, color: '#95a5a6', fontWeight: 'bold', marginBottom: 5 },
  scoreValue: { fontSize: 48, fontWeight: 'bold' },
  noteCard: { backgroundColor: '#fff3cd', padding: 20, borderRadius: 15, marginBottom: 15, borderLeftWidth: 5, borderLeftColor: '#ffc107' },
  noteTitle: { fontWeight: 'bold', color: '#856404', marginBottom: 5 },
  noteText: { color: '#856404', fontSize: 14, lineHeight: 20 },
  errorsCard: { backgroundColor: 'white', padding: 20, borderRadius: 15, ...Platform.select({ web: { boxShadow: '0px 2px 5px rgba(0,0,0,0.05)' }, default: { elevation: 3 } }) },
  errorTitle: { fontSize: 16, fontWeight: 'bold', color: '#e74c3c', marginBottom: 15 },
  errorItem: { backgroundColor:'white', padding:15, borderRadius:10, marginBottom:10, borderBottomWidth:1, borderBottomColor:'#f0f0f0' },
  errorText: { fontSize: 16, marginBottom: 5 },
  errorDesc: { fontSize: 13, color: '#7f8c8d' },
  modalContainer: { flex: 1, backgroundColor: '#f5f6fa' },
  modalHeader: { backgroundColor:'white', padding:20, flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderBottomWidth:1, borderBottomColor:'#eee' },
  modalTitle: { fontSize:20, fontWeight:'bold', color:'#2c3e50' },
  closeButton: { backgroundColor:'#e74c3c', paddingHorizontal:15, paddingVertical:8, borderRadius:8 }
});