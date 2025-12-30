import { useState, useCallback } from 'react';

export interface ModalState<T = void> {
  visible: boolean;
  data: T | null;
  open: (data?: T) => void;
  close: () => void;
}

export function useModal<T = void>(): ModalState<T> {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<T | null>(null);

  const open = useCallback((modalData?: T) => {
    setData(modalData ?? null);
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setData(null);
  }, []);

  return { visible, data, open, close };
}

export interface UseModalControllerResult {
  createGroup: ModalState;
  shareChannel: ModalState<string>;
  nameSetup: ModalState;
  qrScanner: ModalState;
}

export function useModalController(): UseModalControllerResult {
  const createGroup = useModal();
  const shareChannel = useModal<string>();
  const nameSetup = useModal();
  const qrScanner = useModal();

  return {
    createGroup,
    shareChannel,
    nameSetup,
    qrScanner,
  };
}
