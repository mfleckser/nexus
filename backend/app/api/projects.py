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
def list_projects():
    return get_all_projects()


@projects_bp.route("/projects", methods=["POST"])
def create():
    project = create_project(json_body())

    return jsonify(project), 201


@projects_bp.route("/projects/<project_id>/notes", methods=["GET"])
def get_notes(project_id):
    return get_project_notes(project_id)


@projects_bp.route("/projects/<project_id>", methods=["PUT"])
def update(project_id):
    return update_project(project_id, json_body())


@projects_bp.route("/projects/<project_id>", methods=["DELETE"])
def delete(project_id):
    return delete_project(project_id)


@projects_bp.route("/projects/<project_id>/features", methods=["GET"])
def list_features(project_id):
    return get_project_features(project_id)


@projects_bp.route("/projects/<project_id>/features", methods=["POST"])
def add_feature(project_id):
    feature = create_feature(project_id, json_body())

    return jsonify(feature), 201


@projects_bp.route("/features/<feature_id>", methods=["DELETE"])
def remove_feature(feature_id):
    return delete_feature(feature_id)
