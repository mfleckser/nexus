from flask import Blueprint, request, jsonify

from app.services.task_service import (
    get_all_tasks,
    create_task,
    update_task
)

tasks_bp = Blueprint("tasks", __name__)

@tasks_bp.route("/tasks", methods=["GET"])
def list():
    return get_all_tasks()

@tasks_bp.route("/tasks", methods=["POST"])
def create():
    data = request.json

    task = create_task(data)

    return jsonify(task), 201

@tasks_bp.route("/tasks/<id>", methods=["PUT"])
def update(id):
    data = request.json

    return update_task(id, data)
