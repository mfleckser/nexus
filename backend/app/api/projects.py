from flask import Blueprint, request, jsonify

from app.services.project_service import (
    get_all_projects,
    create_project
)

projects_bp = Blueprint("projects", __name__)

@projects_bp.route("/projects", methods=["GET"])
def list():
    return get_all_projects()

@projects_bp.route("/projects", methods=["POST"])
def create():
    data = request.json

    project = create_project(data)

    return jsonify(project), 201

# @events_bp.route("/events", methods=["POST"])
# def create():
#     data = request.json

#     event = create_event(data)

#     return jsonify(event), 201

# @events_bp.route("/events/<id>", methods=["PUT"])
# def update(id):
#     data = request.json

#     return update_event(id, data)

# @events_bp.route("/events/<id>", methods=["DELETE"])
# def delete(id):
#     return delete_event(id)
