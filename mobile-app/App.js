import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import LoginScreen from './screens/LoginScreen';
import MainScreen from './screens/MainScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const prepareApp = async () => {
      try {
        // ⚠️ DEĞİŞİKLİK BURADA:
        // Eskiden burada "AsyncStorage.getItem" ile kullanıcıyı geri getiriyorduk.
        // Şimdi tam tersine, uygulama her başladığında hafızayı TEMİZLİYORUZ.
        // Böylece her seferinde Login ekranı ile başlıyor.
        
        await AsyncStorage.clear(); // Eski oturumu sil
        setUser(null); // Kullanıcıyı boşalt

      } catch (e) {
        console.warn(e);
      } finally {
        // Yükleme ekranını kapat
        setIsLoading(false);
      }
    };

    prepareApp();
  }, []);

  if (isLoading) {
    return ( 
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3498db" />
      </View> 
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          // Kullanıcı giriş yaptıysa Ana Ekran
          <Stack.Screen name="Main">
            {props => <MainScreen {...props} user={user} setUser={setUser} />}
          </Stack.Screen>
        ) : (
          // Kullanıcı yoksa (veya uygulama yeni açıldıysa) Giriş Ekranı
          <Stack.Screen name="Login">
            {props => <LoginScreen {...props} setUser={setUser} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}