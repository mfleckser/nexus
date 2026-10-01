from flask import Blueprint, jsonify

from app.services.task_service import create_task, delete_task, get_all_tasks, update_task
from app.validation import json_body

tasks_bp = Blueprint("tasks", __name__)


@tasks_bp.route("/tasks", methods=["GET"])
def list():
    return get_all_tasks()


@tasks_bp.route("/tasks", methods=["POST"])
def create():
    task = create_task(json_body())

    return jsonify(task), 201


@tasks_bp.route("/tasks/<id>", methods=["PUT"])
def update(id):
    return update_task(id, json_body())


@tasks_bp.route("/tasks/<id>", methods=["DELETE"])
def delete(id):
    return delete_task(id)
