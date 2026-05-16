import unittest

from backend.services.vessel_ais import (
    finalize_vessel_record,
    merge_ais_stream_message,
    navigational_status_label,
    new_vessel_accumulator,
)
from backend.services.maritime_intel import (
    classify_ais_ship_type,
    match_destination_to_port,
    find_nearest_ports,
)


class VesselAisTests(unittest.TestCase):
    def test_merge_position_report_and_ship_static(self):
        acc = new_vessel_accumulator("259000420")
        merge_ais_stream_message(
            acc,
            {
                "MessageType": "PositionReport",
                "MetaData": {
                    "MMSI": 259000420,
                    "ShipName": "AUGUSTSON",
                    "latitude": 66.02695,
                    "longitude": 12.253821666666665,
                    "time_utc": "2022-12-29 18:22:32.318353 +0000 UTC",
                },
                "Message": {
                    "PositionReport": {
                        "Sog": 12.5,
                        "Cog": 308,
                        "TrueHeading": 235,
                        "NavigationalStatus": 0,
                        "RateOfTurn": 4,
                        "Valid": True,
                    }
                },
            },
        )
        merge_ais_stream_message(
            acc,
            {
                "MessageType": "ShipStaticData",
                "MetaData": {"MMSI": 259000420, "time_utc": "2022-12-29 18:23:00 +0000 UTC"},
                "Message": {
                    "ShipStaticData": {
                        "ImoNumber": 9353333,
                        "CallSign": "LBHF",
                        "Destination": "ROTTERDAM",
                        "Type": 82,
                        "MaximumStaticDraught": 4.5,
                        "Dimension": {"A": 20, "B": 27, "C": 7, "D": 7},
                        "Eta": {"Day": 12, "Month": 5, "Hour": 14, "Minute": 30},
                    }
                },
            },
        )

        record = finalize_vessel_record(
            acc,
            classify_ship_type=classify_ais_ship_type,
            match_destination_to_port=match_destination_to_port,
            find_nearest_ports=find_nearest_ports,
        )
        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record["mmsi"], "259000420")
        self.assertEqual(record["vessel_name"], "AUGUSTSON")
        self.assertEqual(record["speed_knots"], 12.5)
        self.assertEqual(record["imo"], "9353333")
        self.assertEqual(record["ship_type_label"], "Tanker")
        self.assertEqual(record["navigational_status_label"], navigational_status_label(0))
        self.assertIn("PositionReport", record["message_types_seen"])
        self.assertIn("ShipStaticData", record["message_types_seen"])
        self.assertEqual(record["dimensions"]["length_m"], 47)


if __name__ == "__main__":
    unittest.main()
