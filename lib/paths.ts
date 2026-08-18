import path from "node:path";

/** Resolve learning-system paths from the project root (Pi cwd). */
export function projectPaths(root: string) {
	const learner = path.join(root, "learner");
	return {
		root,
		learner,
		concepts: path.join(learner, "concepts.json"),
		evidence: path.join(learner, "evidence.jsonl"),
		profile: path.join(learner, "profile.md"),
		preferences: path.join(learner, "preferences.md"),
		pending: path.join(learner, "pending-quiz.json"),
		mission: path.join(root, "MISSION.md"),
		records: path.join(root, "learning-records"),
		lessons: path.join(root, "lessons"),
		visuals: path.join(root, "visuals"),
		teachSkill: path.join(root, ".pi", "skills", "teach", "SKILL.md"),
		pedagogy: path.join(root, ".pi", "skills", "teach", "pedagogy.md"),
		grading: path.join(root, ".pi", "skills", "teach", "grading.md"),
		agents: path.join(root, ".pi", "agents"),
	};
}

export type ProjectPaths = ReturnType<typeof projectPaths>;
