package cache

import (
	"bytes"
	"encoding/binary"
	"errors"
)

func encodeEntry(e Entry) ([]byte, error) {
	cc := []byte(e.CacheControl)
	if len(cc) > 65535 {
		return nil, errors.New("cache-control too long")
	}
	buf := bytes.NewBuffer(make([]byte, 0, 8+len(cc)+len(e.Body)))
	if err := binary.Write(buf, binary.BigEndian, int32(e.StatusCode)); err != nil {
		return nil, err
	}
	if err := binary.Write(buf, binary.BigEndian, uint16(len(cc))); err != nil {
		return nil, err
	}
	if _, err := buf.Write(cc); err != nil {
		return nil, err
	}
	if _, err := buf.Write(e.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func decodeEntry(data []byte, e *Entry) error {
	if len(data) < 6 {
		return errors.New("entry too short")
	}
	var status int32
	if err := binary.Read(bytes.NewReader(data[:4]), binary.BigEndian, &status); err != nil {
		return err
	}
	var ccLen uint16
	if err := binary.Read(bytes.NewReader(data[4:6]), binary.BigEndian, &ccLen); err != nil {
		return err
	}
	if int(6+ccLen) > len(data) {
		return errors.New("entry truncated")
	}
	e.StatusCode = int(status)
	e.CacheControl = string(data[6 : 6+ccLen])
	e.Body = append([]byte(nil), data[6+ccLen:]...)
	return nil
}
