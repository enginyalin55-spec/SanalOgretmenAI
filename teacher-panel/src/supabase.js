import { createClient } from '@supabase/supabase-js';

// Backend'deki .env dosyasından kopyala
const supabaseUrl = 'https://dkdhfjfrfwhofmqcwvck.supabase.co'; 
const supabaseKey = 'sb_publishable_YSEuoCWCktmP6dLtKAvkDw_NjMGP6ZR'; 

export const supabase = createClient(supabaseUrl, supabaseKey);