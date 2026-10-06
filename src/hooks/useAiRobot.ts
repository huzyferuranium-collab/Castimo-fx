import { useState, useEffect } from 'react';
import { aiRobotEngine, AiRobotState } from '../services/aiRobotState';

export const useAiRobot = (): {
  state: AiRobotState;
  toggleSound: () => boolean;
} => {
  const [state, setState] = useState<AiRobotState>(aiRobotEngine.getState());

  useEffect(() => {
    const unsubscribe = aiRobotEngine.subscribe(() => {
      setState({ ...aiRobotEngine.getState() });
    });
    return () => unsubscribe();
  }, []);

  return {
    state,
    toggleSound: () => aiRobotEngine.toggleSound(),
  };
};
