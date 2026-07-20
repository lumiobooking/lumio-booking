import React, { useCallback, useState } from 'react';
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native';
import { PairScreen } from './src/screens/PairScreen';
import { CompanionScreen } from './src/screens/CompanionScreen';
import { api } from './src/api';

export default function App() {
  const [paired, setPaired] = useState(false);

  // Stripe Terminal SDK connection token, proxied via the agent endpoint
  // (uses the salon's own Stripe key on the backend).
  const tokenProvider = useCallback(async () => {
    const { secret } = await api.connectionToken();
    return secret ?? '';
  }, []);

  if (!paired) return <PairScreen onPaired={() => setPaired(true)} />;

  return (
    <StripeTerminalProvider logLevel="verbose" tokenProvider={tokenProvider}>
      <CompanionScreen />
    </StripeTerminalProvider>
  );
}
