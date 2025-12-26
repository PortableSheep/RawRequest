package secretvaultlogic

import (
    "encoding/base64"
    "errors"
    "strings"
)

func DecodeKeyFromFileBase64(encoded string) ([]byte, error) {
    return decodeKeyBase64(encoded, errors.New("vault key has invalid length"))
}

func DecodeKeyFromKeyringBase64(encoded string) ([]byte, error) {
    return decodeKeyBase64(encoded, errors.New("invalid key length from keyring"))
}

func decodeKeyBase64(encoded string, invalidLengthErr error) ([]byte, error) {
    decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
    if err != nil {
        return nil, err
    }
    if len(decoded) != 32 {
        return nil, invalidLengthErr
    }
    return decoded, nil
}
