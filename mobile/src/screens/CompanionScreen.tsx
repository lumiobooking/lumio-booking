import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useStripeTerminal, Reader } from '@stripe/stripe-terminal-react-native';
import { api } from '../api';

const LOCATION_ID = (process.env.EXPO_PUBLIC_STRIPE_LOCATION as string) ?? '';

/**
 * The Companion is a payment BRIDGE, not a POS. It connects a Bluetooth reader,
 * then loops: poll the backend for a queued payment command, execute it on the
 * reader via the Stripe Terminal SDK, and post the result back. The cashier still
 * rings up the sale on POS Web — the amount comes from the backend, not typed here.
 */
export function CompanionScreen() {
  const [status, setStatus] = useState('Connect a reader to begin');
  const [readers, setReaders] = useState<Reader.Type[]>([]);
  const busyRef = useRef(false);

  const {
    discoverReaders, connectBluetoothReader, connectedReader,
    retrievePaymentIntent, collectPaymentMethod, confirmPaymentIntent,
  } = useStripeTerminal({ onUpdateDiscoveredReaders: setReaders });

  async function scan() {
    setStatus('Scanning Bluetooth…');
    const { error } = await discoverReaders({ discoveryMethod: 'bluetoothScan', simulated: false });
    if (error) setStatus('Discover: ' + error.message);
  }

  async function connect(reader: Reader.Type) {
    setStatus('Connecting…');
    const { error } = await connectBluetoothReader({ reader, locationId: LOCATION_ID });
    if (error) { setStatus('Connect: ' + error.message); return; }
    try {
      await api.registerReader('stripe', reader.serialNumber, reader.deviceType);
      setStatus('Ready — waiting for sales');
    } catch (e) { setStatus('Register: ' + (e instanceof Error ? e.message : 'error')); }
  }

  // Poll loop: pick up queued commands and run them on the connected reader.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive || busyRef.current || !connectedReader) return;
      try {
        const { command } = await api.poll();
        if (command && command.clientSecret) {
          busyRef.current = true;
          setStatus(`Charging $${(command.amountCents / 100).toFixed(2)} — present card`);
          try {
            const r1 = await retrievePaymentIntent(command.clientSecret);
            if (r1.error || !r1.paymentIntent) throw new Error(r1.error?.message || 'retrieve');
            const r2 = await collectPaymentMethod({ paymentIntent: r1.paymentIntent });
            if (r2.error || !r2.paymentIntent) throw new Error(r2.error?.message || 'collect');
            const r3 = await confirmPaymentIntent({ paymentIntent: r2.paymentIntent });
            if (r3.error) throw new Error(r3.error.message);
            await api.result(command.intentId, 'SUCCEEDED', r3.paymentIntent?.id);
            setStatus('✅ Paid — waiting for sales');
          } catch (e) {
            await api.result(command.intentId, 'FAILED', undefined, e instanceof Error ? e.message : 'error');
            setStatus('✗ ' + (e instanceof Error ? e.message : 'error'));
          } finally {
            busyRef.current = false;
          }
        }
      } catch { /* offline / nothing queued */ }
    };
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [connectedReader, retrievePaymentIntent, collectPaymentMethod, confirmPaymentIntent]);

  return (
    <ScrollView style={styles.c} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>Payment Companion</Text>
      <Text style={styles.status}>{connectedReader ? `Reader: ${connectedReader.deviceType}` : 'No reader connected'}</Text>

      {!connectedReader && (
        <>
          <TouchableOpacity style={styles.btn} onPress={scan}><Text style={styles.btnText}>Scan Bluetooth readers</Text></TouchableOpacity>
          {readers.map((r, i) => (
            <TouchableOpacity key={i} style={styles.readerRow} onPress={() => connect(r)}>
              <Text style={styles.readerName}>{r.deviceType} · {r.serialNumber}</Text>
              <Text style={styles.connect}>Connect →</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      <View style={styles.statusBox}><Text style={styles.statusBig}>{status}</Text></View>
      <Text style={styles.hint}>Keep this app open next to the reader. Sales are started from POS Web.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#0f172a' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  status: { color: '#94a3b8', marginTop: 4, marginBottom: 16 },
  btn: { backgroundColor: '#6366f1', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  readerRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#1e293b', borderRadius: 8, padding: 12, marginTop: 8 },
  readerName: { color: '#e2e8f0', fontSize: 13 },
  connect: { color: '#a5b4fc', fontWeight: '700' },
  statusBox: { backgroundColor: '#1e293b', borderRadius: 10, padding: 16, marginTop: 20, borderWidth: 1, borderColor: '#334155' },
  statusBig: { color: '#e2e8f0', fontSize: 16, textAlign: 'center' },
  hint: { color: '#64748b', fontSize: 12, textAlign: 'center', marginTop: 12 },
});
