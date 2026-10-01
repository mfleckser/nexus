from flask import Blueprint, jsonify, request

from app.services.project_service import (
    create_feature,
    create_project,
    delete_feature,
    delete_project,
    get_all_projects,
    get_project_features,
    get_project_notes,
    update_project,
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


@projects_bp.route("/projects/<id>/notes", methods=["GET"])
def get_notes(id):
    return get_project_notes(id)


@projects_bp.route("/projects/<id>", methods=["PUT"])
def update(id):
    data = request.json

    return update_project(id, data)


@projects_bp.route("/projects/<id>", methods=["DELETE"])
def delete(id):
    return delete_project(id)


@projects_bp.route("/projects/<id>/features", methods=["GET"])
def list_f(id):
    return get_project_features(id)


@projects_bp.route("/projects/<id>/features", methods=["POST"])
def create_f(id):
    data = request.json

    feature = create_feature(id, data)

    return jsonify(feature), 201


@projects_bp.route("/features/<id>", methods=["DELETE"])
def delete_f(id):
    return delete_feature(id)
