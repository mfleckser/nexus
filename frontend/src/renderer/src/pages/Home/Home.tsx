import Calendar from "./Calendar"
import TaskView from "./TaskView"
import { getTasks } from "@renderer/api/task";
import "./home.css"

function Home(): React.JSX.Element {
    async function handleButton() {
        console.log(await getTasks());
    }

    return (
        <div className="home-shell">
            <button onClick={handleButton}>Press</button>
            <div className="home-calendar">
                <Calendar />
            </div>
            <TaskView />
        </div>
    );
}

export default Home
