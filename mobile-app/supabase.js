import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

// KENDİ PROJE BİLGİLERİNİ BURAYA YAZ:
const supabaseUrl = 'https://dkdhfjfrfwhofmqcwvck.supabase.co'; 
const supabaseKey = 'sb_publishable_YSEuoCWCktmP6dLtKAvkDw_NjMGP6ZR'; 

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Uygulama durumu değiştiğinde oturumu yenilemek için (Opsiyonel ama iyi)
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});