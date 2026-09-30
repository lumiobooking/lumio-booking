export function Broken() {
  const [a, setA] = useState(0);
  if (!a) return null;
  useEffect(() => { setA(1); }, []);
  return <div />;
}
