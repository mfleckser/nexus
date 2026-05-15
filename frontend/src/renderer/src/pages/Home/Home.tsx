import Calendar from "./Calendar"
import "./home.css"

function Home(): React.JSX.Element {
    return (
        <div className="home-shell">
            <Calendar />
        </div>
    );
}

export default Home
