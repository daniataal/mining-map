from __future__ import annotations

import uuid
import unittest
import os
import sys
from unittest.mock import patch

from fastapi import BackgroundTasks

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import backend.main as main


class FakeConnection:
    def close(self):
        pass


class FakeDealRoomServices:
    def __init__(self):
        self.rooms = {}
        self.jobs = {}
        self.cache = {}
        self.entity = {
            "id": "lic-1",
            "entityKind": "license",
            "company": "Acme Mining",
            "country": "Ghana",
            "commodity": "Gold",
            "confidenceScore": 0.8,
        }

    def create_deal_room(self, conn, **kwargs):
        room_id = str(uuid.uuid4())
        room = {
            "id": room_id,
            "title": kwargs.get("title") or "Acme Mining Investigation",
            "entityId": kwargs["entity_id"],
            "entityKind": kwargs.get("entity_kind") or "license",
            "status": kwargs.get("status") or "open",
            "routeSnapshot": kwargs.get("route_snapshot"),
            "agentJobIds": [],
            "evidence": {"entity": self.entity, "agentOutputs": {}},
            "notes": kwargs.get("notes"),
            "createdAt": "2026-01-01T00:00:00",
            "updatedAt": "2026-01-01T00:00:00",
        }
        self.rooms[room_id] = room
        return room

    def list_deal_rooms(self, conn, **kwargs):
        rooms = list(self.rooms.values())
        if not kwargs.get("include_archived"):
            rooms = [room for room in rooms if room.get("status") != "archived"]
        entity_id = kwargs.get("entity_id")
        entity_kind = kwargs.get("entity_kind")
        if entity_id:
            rooms = [room for room in rooms if room.get("entityId") == entity_id]
        if entity_kind:
            rooms = [room for room in rooms if room.get("entityKind") == entity_kind]
        return rooms

    def get_deal_room(self, conn, deal_room_id):
        return self.rooms.get(deal_room_id)

    def update_deal_room(self, conn, deal_room_id, **kwargs):
        room = self.rooms.get(deal_room_id)
        if not room:
            return None
        if kwargs.get("notes") is not None:
            room["notes"] = kwargs["notes"]
        if kwargs.get("status") is not None:
            room["status"] = kwargs["status"]
        if kwargs.get("route_snapshot") is not None:
            room["routeSnapshot"] = kwargs["route_snapshot"]
        if kwargs.get("evidence") is not None:
            room["evidence"] = kwargs["evidence"]
        return room

    def load_entity_basics(self, conn, entity_id, entity_kind="license"):
        return dict(self.entity, id=entity_id, entityKind=entity_kind)

    def get_deal_room_jobs(self, conn, room):
        return [self.jobs[job_id] for job_id in room.get("agentJobIds", []) if job_id in self.jobs]

    def attach_agent_jobs(self, conn, deal_room_id, jobs):
        room = self.rooms[deal_room_id]
        for job in jobs:
            if job["job_id"] not in room["agentJobIds"]:
                room["agentJobIds"].append(job["job_id"])
            self.jobs[job["job_id"]] = job
        return room

    def update_deal_room_evidence_from_job(self, conn, deal_room_id, job):
        room = self.rooms[deal_room_id]
        room["evidence"].setdefault("agentOutputs", {})[job["agent_type"]] = job["output"]

    def enqueue_due_diligence_summary(self, conn, **kwargs):
        return self._cached_job("due_diligence_summary", {"status": "available", "confidence": 0.72})

    def enqueue_procurement_summary(self, conn, **kwargs):
        return self._cached_job(
            "procurement_summary",
            {"status": "completed", "summary": {"awardCount": 1, "totalAwardedUsd": 1250000}, "confidence": 0.7},
        )

    def _cached_job(self, agent_type, output):
        cached = agent_type in self.cache
        job_id = self.cache.setdefault(agent_type, f"job-{agent_type}")
        job = {
            "job_id": job_id,
            "agent_type": agent_type,
            "status": "completed",
            "entity_id": "lic-1",
            "input_hash": f"hash-{agent_type}",
            "output": output,
            "error": None,
            "cached": cached,
        }
        self.jobs[job_id] = job
        return job

    def build_export_package(self, conn, deal_room_id):
        room = self.rooms.get(deal_room_id)
        if not room:
            return None
        outputs = {
            job["agent_type"]: job["output"]
            for job in self.get_deal_room_jobs(conn, room)
            if job["status"] == "completed"
        }
        package = {
            "dealRoom": room,
            "entity": self.entity,
            "routeSummary": {"status": "attached"},
            "agentOutputs": outputs,
            "procurementAwardsSummary": outputs.get("procurement_summary", {}).get("summary", {}),
            "risks": [],
            "confidence": 0.74,
            "decision": "proceed",
            "markdown": "# Decision Package: Acme Mining\n\n- Decision: proceed\n",
        }
        return package


class DealRoomEndpointTests(unittest.TestCase):
    def test_create_update_run_export_and_cache(self):
        fake_services = FakeDealRoomServices()
        with patch.object(main, "get_db_connection", return_value=FakeConnection()), patch.object(
            main, "_load_deal_room_services", return_value=fake_services
        ):
            room = main.create_deal_room_endpoint(
                main.DealRoomCreateRequest(
                    entity_id="lic-1",
                    entity_kind="license",
                    route_snapshot={"result": {"source": "live", "breakdown": []}},
                )
            )
            self.assertEqual(room["entity"]["company"], "Acme Mining")

            listed = main.list_deal_rooms_endpoint(entity_id="lic-1")
            self.assertEqual(listed[0]["id"], room["id"])

            patched = main.update_deal_room_endpoint(
                room["id"],
                main.DealRoomPatchRequest(notes="Need assay certificate.", status="investigating"),
            )
            self.assertEqual(patched["notes"], "Need assay certificate.")
            self.assertEqual(patched["status"], "investigating")

            first_run = main.run_deal_room_agents_endpoint(
                room["id"],
                main.DealRoomAgentRunRequest(agents=["dd", "procurement"]),
                BackgroundTasks(),
            )
            self.assertEqual(
                {job["agent_type"] for job in first_run["jobs"]},
                {"due_diligence_summary", "procurement_summary"},
            )
            self.assertFalse(first_run["jobs"][0]["cached"])

            second_run = main.run_deal_room_agents_endpoint(
                room["id"],
                main.DealRoomAgentRunRequest(agents=["dd"]),
                BackgroundTasks(),
            )
            self.assertEqual(second_run["jobs"][0]["job_id"], "job-due_diligence_summary")
            self.assertTrue(second_run["jobs"][0]["cached"])

            exported = main.export_deal_room_endpoint(room["id"])
            self.assertEqual(exported["decision"], "proceed")
            self.assertEqual(exported["procurementAwardsSummary"]["awardCount"], 1)

            exported_md = main.export_deal_room_endpoint(room["id"], format="markdown")
            self.assertIn("Decision Package", exported_md.body.decode("utf-8"))

    def test_archive_hides_room_from_default_list(self):
        fake_services = FakeDealRoomServices()
        with patch.object(main, "get_db_connection", return_value=FakeConnection()), patch.object(
            main, "_load_deal_room_services", return_value=fake_services
        ):
            room = main.create_deal_room_endpoint(
                main.DealRoomCreateRequest(entity_id="lic-1", entity_kind="license")
            )
            main.update_deal_room_endpoint(
                room["id"],
                main.DealRoomPatchRequest(status="archived"),
            )
            active_only = main.list_deal_rooms_endpoint()
            self.assertEqual(active_only, [])
            with_archived = main.list_deal_rooms_endpoint(include_archived=True)
            self.assertEqual(with_archived[0]["status"], "archived")

