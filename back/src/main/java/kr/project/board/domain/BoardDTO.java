package kr.project.board.domain;

import lombok.Data;

@Data
public class BoardDTO {
    private int boardIdx;
    private String boardTitle;
    private String boardContent;
    private String boardCreateTime;
    private String boardUpdateTime;
    private Boolean del;    
}
