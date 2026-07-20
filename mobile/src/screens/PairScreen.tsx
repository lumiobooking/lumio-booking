import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { api } from '../api';

export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pair() {
    setBusy(true); setError(null);
    try { await api.pair(code.trim().toUpperCase()); onPaired(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Pairing failed'); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <Text style={styles.title}>Lumio Payment Companion</Text>
      <Text style={styles.sub}>Enter the pairing code from your salon's Payment settings (Card terminals → Devices & Agents → Add Companion).</Text>
      <TextInput style={styles.input} placeholder="PAIRING CODE" autoCapitalize="characters" value={code} onChangeText={setCode} />
      {error && <Text style={styles.err}>{error}</Text>}
      <TouchableOpacity style={styles.btn} onPress={pair} disabled={busy || !code.trim()}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Pair this device</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0f172a' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', textAlign: 'center' },
  sub: { color: '#94a3b8', textAlign: 'center', marginVertical: 16, fontSize: 13, lineHeight: 19 },
  input: { backgroundColor: '#1e293b', color: '#fff', borderRadius: 10, padding: 16, fontSize: 22, letterSpacing: 4, textAlign: 'center', borderWidth: 1, borderColor: '#334155' },
  err: { color: '#fca5a5', marginTop: 10, textAlign: 'center' },
  btn: { backgroundColor: '#6366f1', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
