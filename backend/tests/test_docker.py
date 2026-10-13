import pytest

from mogo.config import RepoConfig
from mogo.docker import docker_problem


def cfg(**kw):
    return RepoConfig(name="acme/api", stack="docker", **kw)


def test_dockerfile_default_name(tmp_path):
    assert "no Dockerfile" in docker_problem(cfg(), tmp_path)
    (tmp_path / "Dockerfile").write_text("FROM x\n")
    assert docker_problem(cfg(), tmp_path) is None
    assert docker_problem(cfg(docker_mode="dockerfile"), tmp_path) is None


def test_dockerfile_with_its_own_name(tmp_path):
    (tmp_path / "Dockerfile").write_text("FROM x\n")  # the default one does not help
    assert "no Dockerfile.dev" in docker_problem(cfg(docker_file="Dockerfile.dev"), tmp_path)
    (tmp_path / "Dockerfile.dev").write_text("FROM x\n")
    assert docker_problem(cfg(docker_file="Dockerfile.dev"), tmp_path) is None


def test_compose_default_file_is_docker_compose_yaml(tmp_path):
    assert "no docker-compose.yaml" in docker_problem(cfg(docker_mode="compose"), tmp_path)
    (tmp_path / "docker-compose.yaml").write_text("services: {}\n")
    assert docker_problem(cfg(docker_mode="compose"), tmp_path) is None


@pytest.mark.parametrize("other", ["compose.yaml", "compose.yml", "docker-compose.yml"])
def test_another_compose_name_is_not_the_default(tmp_path, other):
    (tmp_path / other).write_text("services: {}\n")
    assert "no docker-compose.yaml" in docker_problem(cfg(docker_mode="compose"), tmp_path)  # name it to use it
    assert docker_problem(cfg(docker_mode="compose", docker_file=other), tmp_path) is None


def test_compose_with_its_own_name_wants_that_file(tmp_path):
    (tmp_path / "docker-compose.yaml").write_text("services: {}\n")
    assert "docker-compose.prod.yml" in docker_problem(cfg(docker_mode="compose", docker_file="docker-compose.prod.yml"), tmp_path)


@pytest.mark.parametrize("name", ["../Dockerfile", "/etc/passwd", "a/b", "x; rm -rf ~", "$(id)", "a b", "-f", ".hidden", "a\nb"])
def test_names_a_shell_or_a_path_could_misuse_are_refused(tmp_path, name):
    for mode in ("dockerfile", "compose"):
        assert "not a file name" in docker_problem(cfg(docker_mode=mode, docker_file=name), tmp_path)


# --- where a Compose app answers

import json  # noqa: E402

from mogo.docker import compose_ready_url  # noqa: E402


def compose_out(services):
    return json.dumps({"name": "x", "services": services})


def ports(*published):
    return [{"mode": "ingress", "target": 80, "published": str(p), "protocol": "tcp"} for p in published]


def fake_run(out, code=0, seen=None):
    def run(cmd, cwd, timeout=600, env=None):
        if seen is not None:
            seen.append((cmd, cwd, env))
        return code, out
    return run


def url(services, **kw):
    return compose_ready_url(cfg(docker_mode="compose", **kw), "/repo", {}, fake_run(compose_out(services)))


def test_the_app_is_the_service_built_from_the_repo_not_the_database():
    assert url({"db": {"image": "postgres", "ports": ports(5432)},
                "server": {"build": {"context": "."}, "ports": ports(8000)}}) == "http://localhost:8000"


def test_the_first_published_port_when_nothing_is_built():
    assert url({"web": {"image": "nginx", "ports": ports(8080, 8443)}, "db": {"ports": ports(5432)}}) == "http://localhost:8080"


def test_ports_without_a_host_port_are_skipped():
    assert url({"web": {"build": ".", "ports": [{"target": 80, "protocol": "tcp"}, *ports(9000)]}}) == "http://localhost:9000"


@pytest.mark.parametrize("services", [{}, {"web": {"build": "."}}, {"web": {"ports": [{"target": 80}]}}, {"web": None}])
def test_nothing_published_means_no_answer(services):
    assert url(services) is None


@pytest.mark.parametrize("out,code", [("not json", 0), ("[]", 0), ("{}", 1), ("", 0)])
def test_unreadable_output_means_no_answer(out, code):
    assert compose_ready_url(cfg(docker_mode="compose"), "/repo", {}, fake_run(out, code)) is None


def test_it_asks_docker_compose_about_the_right_file_in_the_repo():
    seen = []
    compose_ready_url(cfg(docker_mode="compose"), "/repo", {"A": "1"}, fake_run(compose_out({}), seen=seen))
    compose_ready_url(cfg(docker_mode="compose", docker_file="stack.yml"), "/repo", {}, fake_run(compose_out({}), seen=seen))
    assert [c[0] for c in seen] == [
        "docker compose -p mogo-app -f docker-compose.yaml config --format json 2>/dev/null",
        "docker compose -p mogo-app -f stack.yml config --format json 2>/dev/null",
    ]
    assert seen[0][1:] == ("/repo", {"A": "1"})  # from the repo's folder, with its variables (they fill the file in)


def test_a_file_name_a_shell_could_misuse_is_never_run():
    seen = []
    assert compose_ready_url(cfg(docker_mode="compose", docker_file="x; rm -rf ~"), "/repo", {}, fake_run("{}", seen=seen)) is None
    assert seen == []
