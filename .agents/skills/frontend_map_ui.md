# Skill: Frontend Map and Dossier UX

## Objective
Improve the existing TypeScript frontend without replacing its visual language or rendering architecture unnecessarily.

## Procedure

1. Locate the actual map component, map library, state/store, API hooks and dossier components.
2. Trace existing rendering performance and data fetching before changes.
3. Add features through existing component patterns and styling.
4. For dense global layers, avoid thousands of independent DOM markers. Prefer the map library's WebGL/canvas/source-layer approach, viewport/time filtering and carefully justified clustering.
5. Make data status visible: last refreshed, source, confidence and coverage warnings.
6. Test loading, empty, error, partial-data and dense-data states.

## Desired map controls where supported by actual backend data

- Worldwide intelligence layers.
- Middle East / Persian Gulf / Hormuz focused views.
- Oil/mining/vessel/terminal/supplier filters.
- Dossier opening from a selected point.
- Coverage and freshness status.

## Truthfulness rule

Never display an empty Middle East layer as proof that no tankers/assets exist if the provider/database has limited or missing coverage. Display the limitation clearly.
