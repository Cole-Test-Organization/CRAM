import { readFile, rename, writeFile } from "node:fs/promises";
import { jobsPath, statePath, dataDir } from "../utils/paths.js";
import type { BrokerState, JobRecord } from "../types/index.js";
import { ensureDir } from "../utils/index.js";
import { emptyBrokerState, StateRepository } from "./stateRepository.js";

export class FileStateRepository extends StateRepository {
  protected async readState(): Promise<BrokerState> {
    await ensureDir(dataDir);
    try {
      const raw = await readFile(statePath, "utf8");
      if (!raw.trim()) return emptyBrokerState();
      return JSON.parse(raw) as BrokerState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyBrokerState();
      throw error;
    }
  }

  protected async writeState(state: BrokerState): Promise<void> {
    await ensureDir(dataDir);
    await writeFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  protected async readJobs(): Promise<JobRecord[]> {
    await ensureDir(dataDir);
    try {
      const raw = await readFile(jobsPath, "utf8");
      if (!raw.trim()) return [];
      return JSON.parse(raw) as JobRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  protected async writeJobs(jobs: JobRecord[]): Promise<void> {
    await ensureDir(dataDir);
    await writeFileAtomic(jobsPath, `${JSON.stringify(jobs, null, 2)}\n`);
  }
}

export class StateStore extends FileStateRepository {}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempPath, contents);
  await rename(tempPath, filePath);
}
