from flask import Blueprint, request, jsonify

from app.services.project_service import (
    get_all_projects,
    create_project,
    delete_project
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

@projects_bp.route("/projects/<id>", methods=["DELETE"])
def delete(id):
    return delete_project(id)

# @events_bp.route("/events/<id>", methods=["PUT"])
# def update(id):
#     data = request.json

#     return update_event(id, data)

# @events_bp.route("/events/<id>", methods=["DELETE"])
# def delete(id):
#     return delete_event(id)
