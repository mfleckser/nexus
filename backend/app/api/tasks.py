from flask import Blueprint, jsonify

from app.services.task_service import create_task, delete_task, get_all_tasks, update_task
from app.validation import json_body

tasks_bp = Blueprint("tasks", __name__)


@tasks_bp.route("/tasks", methods=["GET"])
def list_tasks():
    return get_all_tasks()


@tasks_bp.route("/tasks", methods=["POST"])
def create():
    task = create_task(json_body())

    return jsonify(task), 201


@tasks_bp.route("/tasks/<task_id>", methods=["PUT"])
def update(task_id):
    return update_task(task_id, json_body())


@tasks_bp.route("/tasks/<task_id>", methods=["DELETE"])
def delete(task_id):
    return delete_task(task_id)
