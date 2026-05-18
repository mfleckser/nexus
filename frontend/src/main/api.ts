import axios from "axios";

const api = axios.create({
    baseURL: "http://127.0.0.1:5000/api",
    timeout: 5000,
});


async function health() {
    const res = await api.get("/health");
    return res.data;
}

export { health }