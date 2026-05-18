
function getTasks() {
    return window.api.apiGet("/tasks")
}

export { getTasks }