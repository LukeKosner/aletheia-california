import argparse
import json
from pathlib import Path

from .pipeline import acquire, enabled, extract, plan, read_json, review


def main():
    parser = argparse.ArgumentParser(description="Opt-in, file-only Form 700 staging; no database load")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "acquire"):
        command = sub.add_parser(name)
        command.add_argument("--index", type=Path, required=True)
        if name == "acquire": command.add_argument("--out", type=Path, required=True)
    for name in ("extract", "review"):
        command = sub.add_parser(name)
        command.add_argument("--out", type=Path, required=True)
        if name == "extract": command.add_argument("--model", required=True)
    args = parser.parse_args()
    try:
        enabled()  # Before any input reads, output writes, subprocesses or network calls.
        if args.command == "plan": result = plan(read_json(args.index))
        elif args.command == "acquire": result = acquire(args.index, args.out)
        elif args.command == "extract": result = extract(args.out, args.model)
        else: result = review(args.out)
        print(json.dumps(result, indent=2))
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"Form 700 stopped: {error}\n")


if __name__ == "__main__":
    main()
