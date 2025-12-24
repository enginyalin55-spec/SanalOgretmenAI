import React, { useState } from 'react';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, 
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard, ScrollView, Modal, FlatList 
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios'; 

import { COUNTRIES, LANGUAGES } from './constants';

// --- SUNUCU ADRESİ ---
const BASE_URL = 'https://sanalogretmenai.onrender.com'; 

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export default function LoginScreen({ setUser }) {
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [classCode, setClassCode] = useState('');
  
  const [selectedCountry, setSelectedCountry] = useState(null); 
  const [selectedLanguage, setSelectedLanguage] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState('');
  
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);
  
  const [loading, setLoading] = useState(false);

  // --- ÖZEL UYARI FONKSİYONU (WEB VE MOBİL İÇİN AYRI) ---
  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
        // Web tarayıcısı için standart pencere
        window.alert(`${title}\n\n${message}`);
    } else {
        // Mobil telefonlar için şık pencere
        Alert.alert(title, message);
    }
  };

  const handleLogin = async () => {
    if (Platform.OS === 'web') {
        // Web'de klavye kapatmaya gerek yok, hata verebilir
    } else {
        Keyboard.dismiss();
    }

    // 1. BOŞ ALAN KONTROLÜ
    if (!name.trim() || !surname.trim() || !selectedLevel || !selectedCountry || !selectedLanguage || !classCode.trim()) {
      showAlert('Eksik Bilgi', 'Lütfen tüm alanları doldurun ve seçimleri yapın.');
      return;
    }

    setLoading(true);

    try {
      console.log(`🕵️ Sorgulanıyor: ${BASE_URL}/check-class/${classCode.trim()}`);
      
      const checkResponse = await axios.get(`${BASE_URL}/check-class/${classCode.trim()}`);
      console.log("Sunucu Cevabı:", checkResponse.data);

      setLoading(false); // Yüklemeyi durdur (Cevap geldi)

      // --- KOD YANLIŞSA ---
      if (checkResponse.data.valid === false) {
          showAlert(
              "⚠️ Hatalı Sınıf Kodu", 
              "Girdiğiniz kod sistemde bulunamadı. Lütfen öğretmeninize danışın."
          );
          return; 
      }

      // 3. HER ŞEY YOLUNDA
      const className = checkResponse.data.class_name;
      console.log("✅ Sınıf Doğrulandı:", className);

      await AsyncStorage.setItem('studentName', name.trim());
      await AsyncStorage.setItem('studentSurname', surname.trim());
      await AsyncStorage.setItem('studentLevel', selectedLevel);
      await AsyncStorage.setItem('studentCountry', selectedCountry.code);
      await AsyncStorage.setItem('studentLanguage', selectedLanguage.name);
      await AsyncStorage.setItem('classCode', classCode.trim().toUpperCase());

      // Kullanıcıyı içeri al
      setTimeout(() => {
        setUser({
          studentName: name.trim(),
          studentSurname: surname.trim(),
          studentLevel: selectedLevel,
          studentCountry: selectedCountry.code,
          studentLanguage: selectedLanguage.name,
          classCode: classCode.trim().toUpperCase()
        });
      }, 100);
      
    } catch (error) {
      console.error("Giriş Hatası:", error);
      setLoading(false); 
      
      if (error.message && error.message.includes("Network Error")) {
           showAlert('Bağlantı Hatası', 'Sunucuya ulaşılamadı. Backend (main.py) açık mı?');
      } else {
           showAlert('Hata', 'Beklenmedik bir sorun oluştu.');
      }
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.container}>
      <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center'}}>
        <View style={styles.formContainer}>
            <Text style={styles.title}>🎓 Sanal Öğretmen</Text>
            <Text style={styles.subtitle}>Öğrenci Kayıt & Giriş</Text>

            {/* AD & SOYAD */}
            <View style={styles.row}>
                <View style={[styles.inputGroup, {flex:1, marginRight:10}]}>
                    <Text style={styles.label}>Ad</Text>
                    <TextInput style={styles.input} placeholder="Adınız" value={name} onChangeText={setName} />
                </View>
                <View style={[styles.inputGroup, {flex:1}]}>
                    <Text style={styles.label}>Soyad</Text>
                    <TextInput style={styles.input} placeholder="Soyadınız" value={surname} onChangeText={setSurname} />
                </View>
            </View>

            {/* SEVİYE SEÇİMİ */}
            <View style={styles.inputGroup}>
                <Text style={styles.label}>Seviye / Kur</Text>
                <TouchableOpacity style={styles.selector} onPress={() => setShowLevelModal(true)}>
                    <Text style={{color: selectedLevel ? '#2c3e50' : '#bdc3c7', fontWeight:'bold'}}>
                        {selectedLevel || "Seviye Seçiniz (A1-C2)"}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* ÜLKE & DİL SEÇİMİ */}
            <View style={styles.row}>
                <View style={[styles.inputGroup, {flex:1, marginRight:10}]}>
                    <Text style={styles.label}>Ülke / Uyruk</Text>
                    <TouchableOpacity style={styles.selector} onPress={() => setShowCountryModal(true)}>
                        <Text style={{color: selectedCountry ? '#2c3e50' : '#bdc3c7', fontSize: 13}}>
                            {selectedCountry ? selectedCountry.name : "Ülke Seç 👇"}
                        </Text>
                    </TouchableOpacity>
                </View>
                <View style={[styles.inputGroup, {flex:1}]}>
                    <Text style={styles.label}>Ana Dil</Text>
                    <TouchableOpacity style={styles.selector} onPress={() => setShowLanguageModal(true)}>
                        <Text style={{color: selectedLanguage ? '#2c3e50' : '#bdc3c7', fontSize: 13}}>
                            {selectedLanguage ? selectedLanguage.name : "Dil Seç 👇"}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* SINIF KODU */}
            <View style={styles.inputGroup}>
                <Text style={styles.label}>🔑 Sınıf Kodu</Text>
                <TextInput 
                    style={[styles.input, styles.codeInput]} 
                    placeholder="KODU GİRİN" 
                    value={classCode} 
                    onChangeText={text => setClassCode(text.toUpperCase())}
                    maxLength={5}
                />
            </View>

            <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Giriş Yap</Text>}
            </TouchableOpacity>
        </View>
      </ScrollView>

      {/* --- MODALLAR --- */}
      <Modal visible={showCountryModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Ülkenizi Seçin</Text>
                <FlatList data={COUNTRIES} keyExtractor={i => i.code} renderItem={({item}) => (
                        <TouchableOpacity style={styles.modalItem} onPress={() => { setSelectedCountry(item); setShowCountryModal(false); }}><Text style={{fontSize:16}}>{item.name}</Text></TouchableOpacity>
                )}/>
                <TouchableOpacity style={styles.closeButton} onPress={() => setShowCountryModal(false)}><Text style={{color:'white'}}>Kapat</Text></TouchableOpacity>
            </View>
        </View>
      </Modal>

      <Modal visible={showLanguageModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Ana Dilinizi Seçin</Text>
                <FlatList data={LANGUAGES} keyExtractor={i => i.code} renderItem={({item}) => (
                        <TouchableOpacity style={styles.modalItem} onPress={() => { setSelectedLanguage(item); setShowLanguageModal(false); }}><Text style={{fontSize:16}}>{item.name}</Text></TouchableOpacity>
                )}/>
                <TouchableOpacity style={styles.closeButton} onPress={() => setShowLanguageModal(false)}><Text style={{color:'white'}}>Kapat</Text></TouchableOpacity>
            </View>
        </View>
      </Modal>

      <Modal visible={showLevelModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {height: 400}]}>
                <Text style={styles.modalTitle}>Seviyenizi Seçin</Text>
                <FlatList data={LEVELS} keyExtractor={i => i} renderItem={({item}) => (
                        <TouchableOpacity style={styles.modalItem} onPress={() => { setSelectedLevel(item); setShowLevelModal(false); }}><Text style={{fontSize:18, fontWeight:'bold', color:'#3498db'}}>{item}</Text></TouchableOpacity>
                )}/>
                <TouchableOpacity style={styles.closeButton} onPress={() => setShowLevelModal(false)}><Text style={{color:'white'}}>Kapat</Text></TouchableOpacity>
            </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  formContainer: { margin: 20, backgroundColor: 'white', padding: 25, borderRadius: 20, ...Platform.select({ web: { boxShadow: '0px 4px 10px rgba(0,0,0,0.1)' }, default: { elevation: 5 } }) },
  title: { fontSize: 24, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 5 },
  subtitle: { fontSize: 14, color: '#7f8c8d', textAlign: 'center', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  inputGroup: { marginBottom: 15 },
  label: { fontSize: 13, color: '#34495e', marginBottom: 5, fontWeight: '600' },
  input: { backgroundColor: '#f1f2f6', padding: 12, borderRadius: 8, fontSize: 15, borderWidth: 1, borderColor: '#e1e1e1', outlineStyle: 'none' },
  selector: { backgroundColor: '#f1f2f6', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e1e1e1', alignItems:'center', minHeight: 45, justifyContent: 'center' },
  codeInput: { borderColor: '#3498db', backgroundColor: '#eef6fc', letterSpacing: 2, fontWeight: 'bold', textAlign: 'center', fontSize: 18 },
  button: { backgroundColor: '#3498db', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', height: '70%', backgroundColor: 'white', borderRadius: 20, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15, color:'#2c3e50' },
  modalItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', alignItems: 'center' },
  closeButton: { marginTop: 10, backgroundColor: '#e74c3c', padding: 12, borderRadius: 10, alignItems: 'center' }
});