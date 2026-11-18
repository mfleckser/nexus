import Calendar from "@renderer/features/calendar/Calendar";
import TaskView from "@renderer/features/tasks/TaskView";
import { useLoadTaskFeatures } from "@renderer/features/projects/useTaskFeatures";
import "./home.css";

function Home(): React.JSX.Element {
    useLoadTaskFeatures();

    return (
        <div className="home-shell">
            <div className="home-calendar">
                <Calendar />
            </div>
            <TaskView />
        </div>
    );
}

export default Home;
