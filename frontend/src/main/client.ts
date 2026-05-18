import axios from "axios";

const client = axios.create({
    baseURL: "http://127.0.0.1:5000/api",
    timeout: 5000,
});


async function health() {
    const res = await client.get("/health");
    return res.data;
}

async function apiGet(path: string) {
    const res = await client.get(path);
    return res.data;
}

async function apiPost(path: string, body: any) {
    const res = await client.post(path, body);
    return res.data;
}

export { client, health, apiGet, apiPost }