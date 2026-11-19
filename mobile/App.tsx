import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AgendaScreen from "./src/components/AgendaScreen";

export default function App() {
    return (
        <SafeAreaProvider>
            <StatusBar style="light" />
            <AgendaScreen />
        </SafeAreaProvider>
    );
}
