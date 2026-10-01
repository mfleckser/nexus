from flask import Blueprint, jsonify

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
from app.validation import json_body

projects_bp = Blueprint("projects", __name__)


@projects_bp.route("/projects", methods=["GET"])
def list():
    return get_all_projects()


@projects_bp.route("/projects", methods=["POST"])
def create():
    project = create_project(json_body())

    return jsonify(project), 201


@projects_bp.route("/projects/<id>/notes", methods=["GET"])
def get_notes(id):
    return get_project_notes(id)


@projects_bp.route("/projects/<id>", methods=["PUT"])
def update(id):
    return update_project(id, json_body())


@projects_bp.route("/projects/<id>", methods=["DELETE"])
def delete(id):
    return delete_project(id)


@projects_bp.route("/projects/<id>/features", methods=["GET"])
def list_f(id):
    return get_project_features(id)


@projects_bp.route("/projects/<id>/features", methods=["POST"])
def create_f(id):
    feature = create_feature(id, json_body())

    return jsonify(feature), 201


@projects_bp.route("/features/<id>", methods=["DELETE"])
def delete_f(id):
    return delete_feature(id)
