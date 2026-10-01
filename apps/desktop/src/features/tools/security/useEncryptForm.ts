import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ALL_PERMISSIONS } from "@/features/tools/security/permissionSets";
import type { EncryptAlgorithm, Permissions } from "@/types";

export function useEncryptForm() {
  const [userPassword, setUserPassword] = useState("");
  const [encryptMetadata, setEncryptMetadata] = useState(true);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [searchParams] = useSearchParams();
  const sealedParam = searchParams.get("sealed");
  const [sealedPath, setSealedPath] = useState(sealedParam ?? "");
  const [holderPath, setHolderPath] = useState("");
  const [holderPassword, setHolderPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [algorithm, setAlgorithm] = useState<EncryptAlgorithm>("aes256");
  const [permissions, setPermissions] = useState<Permissions>(ALL_PERMISSIONS);
  const [decryptPassword, setDecryptPassword] = useState("");

  useEffect(() => {
    if (sealedParam) setSealedPath(sealedParam);
  }, [sealedParam]);

  const resetSecrets = useCallback(() => {
    setUserPassword("");
    setOwnerPassword("");
    setConfirmPassword("");
    setHolderPassword("");
    setDecryptPassword("");
  }, []);

  return {
    userPassword,
    setUserPassword,
    encryptMetadata,
    setEncryptMetadata,
    recipients,
    setRecipients,
    sealedPath,
    setSealedPath,
    holderPath,
    setHolderPath,
    holderPassword,
    setHolderPassword,
    ownerPassword,
    setOwnerPassword,
    confirmPassword,
    setConfirmPassword,
    algorithm,
    setAlgorithm,
    permissions,
    setPermissions,
    decryptPassword,
    setDecryptPassword,
    resetSecrets,
  };
}
