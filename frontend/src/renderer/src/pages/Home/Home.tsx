import Calendar from "./Calendar"
import TaskView from "./TaskView"
import "./home.css"

function Home(): React.JSX.Element {
    return (
        <div className="home-shell">
            <div className="home-calendar">
                <Calendar />
            </div>
            <TaskView />
        </div>
    );
}

export default Home
