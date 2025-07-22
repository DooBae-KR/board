package kr.project.board.domain;

import lombok.Data;

@Data
public class UserDTO {

    private int userIdx;
    private String userId;
    private String userPw;
    private String userName;
    private String userNickName;
    private String createTime;
}
