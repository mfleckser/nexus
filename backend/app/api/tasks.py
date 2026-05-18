from flask import Blueprint, request, jsonify

from app.services.task_service import (
    get_all_tasks,
    create_task
)

tasks_bp = Blueprint("tasks", __name__)

@tasks_bp.route("/tasks", methods=["GET"])
def tasks():
    return get_all_tasks()

@tasks_bp.route("/tasks", methods=["POST"])
def add_task():
    data = request.json

    task = create_task(data)

    return jsonify(task), 201